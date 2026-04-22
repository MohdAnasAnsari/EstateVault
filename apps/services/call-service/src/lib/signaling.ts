import type { Server, Socket } from 'socket.io';
import { createLogger } from '@vault/logger';
import jwt from 'jsonwebtoken';

const logger = createLogger({ base: { service: 'call-service', module: 'signaling' } });

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthenticatedSocket extends Socket {
  userId: string;
  userRole: string;
}

interface IceCandidatePayload {
  candidate: RTCIceCandidateInit;
  to: string; // target socket id
}

interface SdpPayload {
  sdp: RTCSessionDescriptionInit;
  to: string; // target socket id
}

interface JoinPayload {
  callId: string;
  callType: 'audio' | 'video';
}

interface MutePayload {
  kind: 'audio' | 'video';
  muted: boolean;
}

interface ScreenSharePayload {
  sharing: boolean;
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function verifySocketJwt(token: string): { sub: string; role: string } {
  const secret = process.env['NEXTAUTH_SECRET'] ?? 'dev-secret-change-me';
  const payload = jwt.verify(token, secret) as { sub: string; role: string };
  return payload;
}

// ─── Signaling Handlers ───────────────────────────────────────────────────────

export function registerSignalingHandlers(io: Server): void {
  const signalingNs = io.of('/call-signal');

  // JWT auth middleware
  signalingNs.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth as Record<string, string>)['token'] ??
        (socket.handshake.headers['authorization'] ?? '').replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const payload = verifySocketJwt(token);
      (socket as AuthenticatedSocket).userId = payload.sub;
      (socket as AuthenticatedSocket).userRole = payload.role;

      logger.debug({ userId: payload.sub }, 'Socket authenticated');
      next();
    } catch (err) {
      logger.warn({ err }, 'Socket authentication failed');
      next(new Error('Invalid or expired token'));
    }
  });

  signalingNs.on('connection', (rawSocket) => {
    const socket = rawSocket as AuthenticatedSocket;
    logger.info({ userId: socket.userId, socketId: socket.id }, 'Signaling client connected');

    // ── call:join ───────────────────────────────────────────────────────────
    // Client joins a call room. The room name is the callId.
    socket.on('call:join', async (payload: JoinPayload) => {
      const { callId, callType } = payload;
      if (!callId) {
        socket.emit('call:error', { code: 'INVALID_CALL_ID', message: 'callId is required' });
        return;
      }

      await socket.join(callId);

      // Notify others in the room that a new peer has joined
      socket.to(callId).emit('call:peer-joined', {
        socketId: socket.id,
        userId: socket.userId,
        callType,
      });

      // Send the joining user the list of existing participants
      const socketsInRoom = await signalingNs.in(callId).fetchSockets();
      const participants = socketsInRoom
        .filter((s) => s.id !== socket.id)
        .map((s) => ({ socketId: s.id, userId: (s as unknown as AuthenticatedSocket).userId }));

      socket.emit('call:room-state', { callId, participants });

      logger.debug({ userId: socket.userId, callId, callType }, 'Peer joined call room');
    });

    // ── call:offer ──────────────────────────────────────────────────────────
    // Relay SDP offer from caller to a specific peer.
    socket.on('call:offer', (payload: SdpPayload) => {
      const { sdp, to } = payload;
      if (!to || !sdp) {
        socket.emit('call:error', { code: 'INVALID_OFFER', message: 'sdp and to are required' });
        return;
      }

      signalingNs.to(to).emit('call:offer', {
        sdp,
        from: socket.id,
        userId: socket.userId,
      });

      logger.debug({ from: socket.id, to, userId: socket.userId }, 'SDP offer relayed');
    });

    // ── call:answer ─────────────────────────────────────────────────────────
    // Relay SDP answer from callee back to the caller.
    socket.on('call:answer', (payload: SdpPayload) => {
      const { sdp, to } = payload;
      if (!to || !sdp) {
        socket.emit('call:error', { code: 'INVALID_ANSWER', message: 'sdp and to are required' });
        return;
      }

      signalingNs.to(to).emit('call:answer', {
        sdp,
        from: socket.id,
        userId: socket.userId,
      });

      logger.debug({ from: socket.id, to, userId: socket.userId }, 'SDP answer relayed');
    });

    // ── call:ice-candidate ──────────────────────────────────────────────────
    // Relay ICE candidate to a specific peer.
    socket.on('call:ice-candidate', (payload: IceCandidatePayload) => {
      const { candidate, to } = payload;
      if (!to || !candidate) {
        socket.emit('call:error', { code: 'INVALID_ICE', message: 'candidate and to are required' });
        return;
      }

      signalingNs.to(to).emit('call:ice-candidate', {
        candidate,
        from: socket.id,
        userId: socket.userId,
      });
    });

    // ── call:screen-share ───────────────────────────────────────────────────
    // Notify all room participants about a screen share start/stop event.
    socket.on('call:screen-share', (payload: ScreenSharePayload & { callId: string }) => {
      const { callId, sharing } = payload;
      if (!callId) return;

      socket.to(callId).emit('call:screen-share', {
        from: socket.id,
        userId: socket.userId,
        sharing,
      });

      logger.debug({ userId: socket.userId, callId, sharing }, 'Screen share event broadcast');
    });

    // ── call:mute ───────────────────────────────────────────────────────────
    // Notify room peers about a mute state change.
    socket.on('call:mute', (payload: MutePayload & { callId: string }) => {
      const { callId, kind, muted } = payload;
      if (!callId) return;

      socket.to(callId).emit('call:mute', {
        from: socket.id,
        userId: socket.userId,
        kind,
        muted,
      });
    });

    // ── call:leave ──────────────────────────────────────────────────────────
    // Peer voluntarily leaves a call room.
    socket.on('call:leave', async (payload: { callId: string }) => {
      const { callId } = payload;
      if (!callId) return;

      await socket.leave(callId);

      socket.to(callId).emit('call:peer-left', {
        socketId: socket.id,
        userId: socket.userId,
      });

      logger.debug({ userId: socket.userId, callId }, 'Peer left call room');
    });

    // ── disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      logger.info({ userId: socket.userId, socketId: socket.id, reason }, 'Signaling client disconnected');

      // Notify all rooms this socket was part of
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.to(room).emit('call:peer-left', {
            socketId: socket.id,
            userId: socket.userId,
            reason: 'disconnected',
          });
        }
      }
    });
  });
}
