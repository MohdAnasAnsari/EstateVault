import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import {
  SocketFileUploadSchema,
  SocketMessageReadSchema,
  SocketMessageSendSchema,
  SocketRoomJoinSchema,
  SocketTypingSchema,
  type DealRoomMessage,
} from '@vault/types';
import {
  createDealRoomFile,
  createDealRoomMessage,
  getDealRoomParticipants,
  getParticipantForUserInRoom,
  markDealRoomMessageRead,
  touchDealRoomParticipant,
} from './deal-rooms.js';
import type { JwtUser } from './auth.js';

const ROOM_PREFIX = 'deal-room:';
const MESSAGE_LIMIT_PER_MINUTE = 30;

let io: Server | null = null;
const roomOnlineUsers = new Map<string, Map<string, number>>();
const socketRooms = new Map<string, Set<string>>();
const socketUsers = new Map<string, string>();
const typingState = new Map<string, Set<string>>();
const rateLimitState = new Map<string, { count: number; windowStartedAt: number }>();

function getRoomChannel(dealRoomId: string): string {
  return `${ROOM_PREFIX}${dealRoomId}`;
}

function getUserRateStatus(userId: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const existing = rateLimitState.get(userId);
  if (!existing || now - existing.windowStartedAt >= 60_000) {
    rateLimitState.set(userId, { count: 1, windowStartedAt: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count >= MESSAGE_LIMIT_PER_MINUTE) {
    return {
      allowed: false,
      retryAfterMs: Math.max(0, 60_000 - (now - existing.windowStartedAt)),
    };
  }

  existing.count += 1;
  rateLimitState.set(userId, existing);
  return { allowed: true, retryAfterMs: 0 };
}

function addUserToRoomPresence(dealRoomId: string, userId: string): void {
  const roomMap = roomOnlineUsers.get(dealRoomId) ?? new Map<string, number>();
  roomMap.set(userId, (roomMap.get(userId) ?? 0) + 1);
  roomOnlineUsers.set(dealRoomId, roomMap);
}

function removeUserFromRoomPresence(dealRoomId: string, userId: string): void {
  const roomMap = roomOnlineUsers.get(dealRoomId);
  if (!roomMap) return;

  const nextCount = (roomMap.get(userId) ?? 0) - 1;
  if (nextCount <= 0) {
    roomMap.delete(userId);
  } else {
    roomMap.set(userId, nextCount);
  }

  if (roomMap.size === 0) {
    roomOnlineUsers.delete(dealRoomId);
  }
}

function removeTypingState(dealRoomId: string, userId: string): void {
  const roomTyping = typingState.get(dealRoomId);
  if (!roomTyping) return;
  roomTyping.delete(userId);
  if (roomTyping.size === 0) {
    typingState.delete(dealRoomId);
  }
}

async function emitPresenceUpdate(dealRoomId: string): Promise<void> {
  if (!io) return;

  const participants = await getDealRoomParticipants(dealRoomId);
  const onlineSet = new Set(Array.from(roomOnlineUsers.get(dealRoomId)?.keys() ?? []));
  const payload = {
    participants: participants.map((participant) => ({
      id: participant.userId,
      pseudonym: participant.pseudonym,
      online: onlineSet.has(participant.userId),
    })),
  };

  io.to(getRoomChannel(dealRoomId)).emit('presence:update', payload);
}

function emitRoomEvent<T>(dealRoomId: string, event: string, payload: T): void {
  io?.to(getRoomChannel(dealRoomId)).emit(event, payload);
}

function getSocketUser(socket: Socket): JwtUser {
  return socket.data.user as JwtUser;
}

async function joinDealRoom(socket: Socket, dealRoomId: string): Promise<void> {
  const user = getSocketUser(socket);
  const participant = await getParticipantForUserInRoom(dealRoomId, user.userId);
  if (!participant) {
    socket.emit('error', { code: 'DEAL_ROOM_FORBIDDEN', message: 'Access denied for this room' });
    return;
  }

  await socket.join(getRoomChannel(dealRoomId));
  const rooms = socketRooms.get(socket.id) ?? new Set<string>();
  rooms.add(dealRoomId);
  socketRooms.set(socket.id, rooms);
  socketUsers.set(socket.id, user.userId);
  addUserToRoomPresence(dealRoomId, user.userId);
  await touchDealRoomParticipant(dealRoomId, user.userId);
  await emitPresenceUpdate(dealRoomId);
}

function leaveSocketRooms(socket: Socket): void {
  const userId = socketUsers.get(socket.id);
  const joinedRooms = socketRooms.get(socket.id);
  if (!userId || !joinedRooms) return;

  for (const dealRoomId of joinedRooms) {
    removeUserFromRoomPresence(dealRoomId, userId);
    removeTypingState(dealRoomId, userId);
    void emitPresenceUpdate(dealRoomId);
    emitRoomEvent(dealRoomId, 'typing:update', { userId, isTyping: false });
  }

  socketRooms.delete(socket.id);
  socketUsers.delete(socket.id);
}

function getAuthToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth.token;
  if (typeof authToken === 'string' && authToken.length > 0) {
    return authToken.startsWith('Bearer ') ? authToken.slice(7) : authToken;
  }

  const headerToken = socket.handshake.headers.authorization;
  if (typeof headerToken === 'string' && headerToken.length > 0) {
    return headerToken.startsWith('Bearer ') ? headerToken.slice(7) : headerToken;
  }

  return null;
}

export function getOnlineUserIdsForDealRoom(dealRoomId: string): string[] {
  return Array.from(roomOnlineUsers.get(dealRoomId)?.keys() ?? []);
}

export function emitDealRoomStageChange(
  dealRoomId: string,
  payload: { newStatus: string; systemMessage: string },
): void {
  emitRoomEvent(dealRoomId, 'room:stage_change', payload);
}

export function emitDealRoomMessage(message: DealRoomMessage): void {
  emitRoomEvent(message.dealRoomId, 'message:new', message);
}

export async function emitDealRoomPresence(dealRoomId: string): Promise<void> {
  await emitPresenceUpdate(dealRoomId);
}

export function registerDealRoomRealtime(app: FastifyInstance): void {
  if (io) return;

  io = new Server(app.server, {
    cors: {
      origin: [
        'http://localhost:3000',
        process.env['NEXTAUTH_URL'] ?? 'http://localhost:3000',
      ],
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = getAuthToken(socket);
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const payload = app.jwt.verify<JwtUser>(token);
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('Authentication required'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('room:join', async (payload) => {
      try {
        const input = SocketRoomJoinSchema.parse(payload);
        await joinDealRoom(socket, input.dealRoomId);
      } catch (error) {
        socket.emit('error', {
          code: 'ROOM_JOIN_FAILED',
          message: error instanceof Error ? error.message : 'Unable to join room',
        });
      }
    });

    socket.on('message:send', async (payload) => {
      try {
        const input = SocketMessageSendSchema.parse(payload);
        const participant = await getParticipantForUserInRoom(
          input.dealRoomId,
          getSocketUser(socket).userId,
        );
        if (!participant) {
          socket.emit('error', { code: 'DEAL_ROOM_FORBIDDEN', message: 'Access denied for this room' });
          return;
        }
        const rate = getUserRateStatus(getSocketUser(socket).userId);
        if (!rate.allowed) {
          socket.emit('error', {
            code: 'RATE_LIMITED',
            message: 'Message rate limit exceeded',
            details: { retryAfterMs: rate.retryAfterMs },
          });
          return;
        }

        const message = await createDealRoomMessage({
          dealRoomId: input.dealRoomId,
          senderId: getSocketUser(socket).userId,
          senderPublicKey: input.senderPublicKey,
          type: input.type,
          ciphertext: input.ciphertext,
          nonce: input.nonce,
        });

        await touchDealRoomParticipant(input.dealRoomId, getSocketUser(socket).userId);
        emitDealRoomMessage(message);
      } catch (error) {
        socket.emit('error', {
          code: 'MESSAGE_SEND_FAILED',
          message: error instanceof Error ? error.message : 'Unable to send message',
        });
      }
    });

    socket.on('message:read', async (payload) => {
      try {
        const input = SocketMessageReadSchema.parse(payload);
        const message = await markDealRoomMessageRead(input.messageId, getSocketUser(socket).userId);
        const receipt = message.readBy.find((entry) => entry.userId === getSocketUser(socket).userId);
        emitRoomEvent(message.dealRoomId, 'message:read', {
          messageId: message.id,
          userId: getSocketUser(socket).userId,
          readAt: receipt?.readAt ?? new Date().toISOString(),
        });
      } catch (error) {
        socket.emit('error', {
          code: 'MESSAGE_READ_FAILED',
          message: error instanceof Error ? error.message : 'Unable to mark message as read',
        });
      }
    });

    socket.on('typing:start', async (payload) => {
      try {
        const input = SocketTypingSchema.parse(payload);
        const participant = await getParticipantForUserInRoom(input.dealRoomId, getSocketUser(socket).userId);
        if (!participant) {
          socket.emit('error', { code: 'DEAL_ROOM_FORBIDDEN', message: 'Access denied for this room' });
          return;
        }

        const roomTyping = typingState.get(input.dealRoomId) ?? new Set<string>();
        roomTyping.add(getSocketUser(socket).userId);
        typingState.set(input.dealRoomId, roomTyping);
        emitRoomEvent(input.dealRoomId, 'typing:update', {
          userId: getSocketUser(socket).userId,
          isTyping: true,
        });
      } catch (error) {
        socket.emit('error', {
          code: 'TYPING_FAILED',
          message: error instanceof Error ? error.message : 'Unable to update typing state',
        });
      }
    });

    socket.on('typing:stop', async (payload) => {
      try {
        const input = SocketTypingSchema.parse(payload);
        removeTypingState(input.dealRoomId, getSocketUser(socket).userId);
        emitRoomEvent(input.dealRoomId, 'typing:update', {
          userId: getSocketUser(socket).userId,
          isTyping: false,
        });
      } catch (error) {
        socket.emit('error', {
          code: 'TYPING_FAILED',
          message: error instanceof Error ? error.message : 'Unable to update typing state',
        });
      }
    });

    socket.on('file:upload', async (payload) => {
      try {
        const input = SocketFileUploadSchema.parse(payload);
        const result = await createDealRoomFile({
          dealRoomId: input.dealRoomId,
          uploadedBy: getSocketUser(socket).userId,
          payload: {
            category: input.category,
            fileNameEncrypted: input.fileNameEncrypted,
            mimeType: input.mimeType,
            s3Key: input.s3Key,
            sizeBytes: input.sizeBytes,
            nonce: input.nonce,
            wrappedKeys: input.wrappedKeys,
            encryptedBlobBase64: input.encryptedBlobBase64,
            expiresAt: input.expiresAt ?? null,
          },
        });

        emitDealRoomMessage(result.message);
      } catch (error) {
        socket.emit('error', {
          code: 'FILE_UPLOAD_FAILED',
          message: error instanceof Error ? error.message : 'Unable to register file upload',
        });
      }
    });

    socket.on('presence:ping', async () => {
      const user = getSocketUser(socket);
      const joinedRooms = socketRooms.get(socket.id);
      if (!joinedRooms) return;

      for (const dealRoomId of joinedRooms) {
        await touchDealRoomParticipant(dealRoomId, user.userId);
        await emitPresenceUpdate(dealRoomId);
      }
    });

    socket.on('disconnect', () => {
      leaveSocketRooms(socket);
    });
  });
}
