import type { Server, Socket } from 'socket.io';
import { createLogger } from '@vault/logger';
import { getDb } from '@vault/db';
import {
  dealRoomParticipants,
  messages,
} from '@vault/db';
import { eq, and } from 'drizzle-orm';
import { encryptMessage } from './deal-rooms.js';
import { getRedis } from '@vault/cache';

const log = createLogger('messaging-service:realtime');

interface AuthenticatedUser {
  id: string;
  role: string;
  email: string;
}

interface SocketData {
  user: AuthenticatedUser;
}

interface JoinRoomPayload {
  roomId: string;
}

interface MessagePayload {
  roomId: string;
  content: string;
  type?: 'text' | 'file' | 'system';
  metadata?: Record<string, unknown>;
}

interface TypingPayload {
  roomId: string;
}

interface PresencePayload {
  roomId: string;
}

interface FileUploadedPayload {
  roomId: string;
  fileId: string;
  fileName: string;
}

interface OfferSubmittedPayload {
  roomId: string;
  offerId: string;
}

const CHANNEL_PREFIX = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';

async function verifyParticipant(
  userId: string,
  roomId: string,
  db: ReturnType<typeof getDb>,
): Promise<boolean> {
  const participant = await db
    .select({ id: dealRoomParticipants.id })
    .from(dealRoomParticipants)
    .where(
      and(
        eq(dealRoomParticipants.dealRoomId, roomId),
        eq(dealRoomParticipants.userId, userId),
      ),
    )
    .limit(1);

  return participant.length > 0;
}

export function registerSocketHandlers(io: Server) {
  // ── Authentication middleware ──────────────────────────────────────────────
  io.use(async (socket: Socket, next) => {
    try {
      const token =
        (socket.handshake.auth['token'] as string | undefined) ??
        (socket.handshake.headers['authorization'] as string | undefined)?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('AUTH_MISSING: No token provided'));
      }

      // Decode JWT manually — the Fastify JWT instance is not available in
      // Socket.IO middleware, so we verify the payload structure here.
      const parts = token.split('.');
      if (parts.length !== 3) {
        return next(new Error('AUTH_INVALID: Malformed JWT'));
      }

      const payloadPart = parts[1];
      if (!payloadPart) {
        return next(new Error('AUTH_INVALID: Missing payload'));
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<
          string,
          unknown
        >;
      } catch {
        return next(new Error('AUTH_INVALID: Cannot parse JWT payload'));
      }

      const now = Math.floor(Date.now() / 1000);
      const exp = payload['exp'] as number | undefined;
      if (exp && exp < now) {
        return next(new Error('AUTH_EXPIRED: Token has expired'));
      }

      const userId = (payload['sub'] ?? payload['id']) as string | undefined;
      if (!userId) {
        return next(new Error('AUTH_INVALID: Missing user id in token'));
      }

      (socket as Socket & { data: SocketData }).data = {
        user: {
          id: userId,
          role: (payload['role'] as string | undefined) ?? 'buyer',
          email: (payload['email'] as string | undefined) ?? '',
        },
      };

      return next();
    } catch (err) {
      log.error({ err }, 'Socket auth error');
      return next(new Error('AUTH_ERROR: Authentication failed'));
    }
  });

  // ── Connection handler ────────────────────────────────────────────────────
  io.on('connection', (socket: Socket) => {
    const user = (socket as Socket & { data: SocketData }).data.user;
    log.info({ userId: user.id, socketId: socket.id }, 'Client connected');

    // ── join_room ──────────────────────────────────────────────────────────
    socket.on('join_room', async (payload: JoinRoomPayload) => {
      try {
        const { roomId } = payload;
        if (!roomId) {
          socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'roomId is required' });
          return;
        }

        const db = getDb();
        const isParticipant = await verifyParticipant(user.id, roomId, db);

        if (!isParticipant) {
          socket.emit('error', {
            code: 'FORBIDDEN',
            message: 'You are not a participant of this deal room',
          });
          return;
        }

        await socket.join(`deal_room:${roomId}`);

        // Update presence in Redis
        const redis = getRedis();
        await redis.set(
          `presence:${roomId}:${user.id}`,
          JSON.stringify({ online: true, lastSeen: new Date().toISOString() }),
          'EX',
          300,
        );

        socket.emit('room_joined', { roomId });
        socket.to(`deal_room:${roomId}`).emit('participant:online', {
          userId: user.id,
          roomId,
          timestamp: new Date().toISOString(),
        });

        log.debug({ userId: user.id, roomId }, 'User joined deal room');
      } catch (err) {
        log.error({ err, userId: user.id }, 'join_room error');
        socket.emit('error', { code: 'JOIN_FAILED', message: 'Failed to join room' });
      }
    });

    // ── message ────────────────────────────────────────────────────────────
    socket.on('message', async (payload: MessagePayload) => {
      try {
        const { roomId, content, type = 'text', metadata = {} } = payload;

        if (!roomId || !content) {
          socket.emit('error', {
            code: 'INVALID_PAYLOAD',
            message: 'roomId and content are required',
          });
          return;
        }

        const db = getDb();
        const isParticipant = await verifyParticipant(user.id, roomId, db);
        if (!isParticipant) {
          socket.emit('error', { code: 'FORBIDDEN', message: 'Not a participant' });
          return;
        }

        // Get user's public key for encryption
        const participantRow = await db
          .select({ pseudonym: dealRoomParticipants.pseudonym })
          .from(dealRoomParticipants)
          .where(
            and(
              eq(dealRoomParticipants.dealRoomId, roomId),
              eq(dealRoomParticipants.userId, user.id),
            ),
          )
          .limit(1);

        const pseudonym = participantRow[0]?.pseudonym ?? 'Anonymous';

        // Encrypt with a temporary symmetric key stored in room
        // For real-time messages we use a simple nonce-based encryption
        const TEMP_KEY = process.env['NEXTAUTH_SECRET'] ?? 'fallback-key-32-bytes-long-pad!!';
        const paddedKey = Buffer.from(TEMP_KEY.padEnd(32, '!').slice(0, 32)).toString('base64');
        const encrypted = await encryptMessage(content, paddedKey);

        // Persist to DB
        const [saved] = await db
          .insert(messages)
          .values({
            dealRoomId: roomId,
            senderId: user.id,
            type: type as 'text' | 'file' | 'system' | 'nda' | 'offer',
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce,
            contentPreview: content.slice(0, 50) + (content.length > 50 ? '…' : ''),
            metadata,
            deliveredTo: [],
            readBy: [],
            reactions: [],
          })
          .returning();

        const messageEvent = {
          id: saved?.id,
          roomId,
          senderId: user.id,
          senderPseudonym: pseudonym,
          type,
          contentPreview: saved?.contentPreview,
          metadata,
          createdAt: saved?.createdAt,
        };

        io.to(`deal_room:${roomId}`).emit('message:new', messageEvent);

        // Publish to Redis for cross-instance delivery
        const redis = getRedis();
        await redis.set(
          `${CHANNEL_PREFIX}deal_room.message.sent`,
          JSON.stringify({ ...messageEvent, roomId }),
        );

        log.debug({ userId: user.id, roomId, messageId: saved?.id }, 'Message sent');
      } catch (err) {
        log.error({ err, userId: user.id }, 'message event error');
        socket.emit('error', { code: 'SEND_FAILED', message: 'Failed to send message' });
      }
    });

    // ── typing_start ───────────────────────────────────────────────────────
    socket.on('typing_start', (payload: TypingPayload) => {
      const { roomId } = payload;
      if (!roomId) return;
      socket.to(`deal_room:${roomId}`).emit('typing:start', {
        userId: user.id,
        roomId,
        timestamp: new Date().toISOString(),
      });
    });

    // ── typing_stop ────────────────────────────────────────────────────────
    socket.on('typing_stop', (payload: TypingPayload) => {
      const { roomId } = payload;
      if (!roomId) return;
      socket.to(`deal_room:${roomId}`).emit('typing:stop', {
        userId: user.id,
        roomId,
        timestamp: new Date().toISOString(),
      });
    });

    // ── presence ───────────────────────────────────────────────────────────
    socket.on('presence', async (payload: PresencePayload) => {
      try {
        const { roomId } = payload;
        if (!roomId) return;

        const redis = getRedis();
        await redis.set(
          `presence:${roomId}:${user.id}`,
          JSON.stringify({ online: true, lastSeen: new Date().toISOString() }),
          'EX',
          300,
        );

        socket.to(`deal_room:${roomId}`).emit('presence:update', {
          userId: user.id,
          roomId,
          online: true,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        log.error({ err }, 'presence event error');
      }
    });

    // ── file_uploaded ──────────────────────────────────────────────────────
    socket.on('file_uploaded', (payload: FileUploadedPayload) => {
      const { roomId, fileId, fileName } = payload;
      if (!roomId || !fileId) return;
      io.to(`deal_room:${roomId}`).emit('file:uploaded', {
        roomId,
        fileId,
        uploadedBy: user.id,
        fileName: fileName ?? 'File',
        timestamp: new Date().toISOString(),
      });
    });

    // ── offer_submitted ────────────────────────────────────────────────────
    socket.on('offer_submitted', (payload: OfferSubmittedPayload) => {
      const { roomId, offerId } = payload;
      if (!roomId || !offerId) return;
      io.to(`deal_room:${roomId}`).emit('offer:submitted', {
        roomId,
        offerId,
        submittedBy: user.id,
        timestamp: new Date().toISOString(),
      });
    });

    // ── disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason: string) => {
      log.info({ userId: user.id, socketId: socket.id, reason }, 'Client disconnected');

      try {
        const db = getDb();
        const now = new Date();

        // Update last_seen for all rooms the user was in
        const rooms = Array.from(socket.rooms).filter((r) => r.startsWith('deal_room:'));
        await Promise.all(
          rooms.map(async (roomKey) => {
            const roomId = roomKey.replace('deal_room:', '');
            await db
              .update(dealRoomParticipants)
              .set({ lastSeenAt: now })
              .where(
                and(
                  eq(dealRoomParticipants.dealRoomId, roomId),
                  eq(dealRoomParticipants.userId, user.id),
                ),
              );

            // Clear Redis presence
            const redis = getRedis();
            await redis.set(
              `presence:${roomId}:${user.id}`,
              JSON.stringify({ online: false, lastSeen: now.toISOString() }),
              'EX',
              3600,
            );

            socket.to(`deal_room:${roomId}`).emit('participant:offline', {
              userId: user.id,
              roomId,
              timestamp: now.toISOString(),
            });
          }),
        );
      } catch (err) {
        log.error({ err, userId: user.id }, 'disconnect cleanup error');
      }
    });
  });
}
