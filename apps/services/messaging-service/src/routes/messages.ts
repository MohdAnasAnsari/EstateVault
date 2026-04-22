import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import {
  messages,
  dealRoomParticipants,
  dealRoomFiles,
  dealRooms,
  users,
} from '@vault/db';
import { eq, and, lt, desc, asc } from 'drizzle-orm';
import { getRedis } from '@vault/cache';
import {
  encryptFile,
  decryptFile,
  wrapFileKey,
  unwrapFileKey,
  encryptSymmetric,
  decryptSymmetric,
} from '@vault/crypto';
import { encryptMessage, decryptMessage } from '../lib/deal-rooms.js';

const CHANNEL_PREFIX = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(request: FastifyRequest): string {
  const userId = request.headers['x-user-id'] as string | undefined;
  if (!userId) throw new Error('X-User-Id header is required');
  return userId;
}

function ok(reply: FastifyReply, data: unknown, statusCode = 200) {
  return reply.status(statusCode).send({ success: true, data });
}

function errRes(reply: FastifyReply, code: string, message: string, statusCode = 400) {
  return reply.status(statusCode).send({ success: false, error: { code, message } });
}

async function requireParticipant(
  userId: string,
  roomId: string,
  db: ReturnType<typeof getDb>,
): Promise<(typeof dealRoomParticipants.$inferSelect) | null> {
  const rows = await db
    .select()
    .from(dealRoomParticipants)
    .where(
      and(
        eq(dealRoomParticipants.dealRoomId, roomId),
        eq(dealRoomParticipants.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function getRoomSymKey(): string {
  const secret = process.env['NEXTAUTH_SECRET'] ?? 'change-me-32-bytes-long-padding!';
  return Buffer.from(secret.padEnd(32, '!').slice(0, 32)).toString('base64');
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const sendMessageSchema = z.object({
  content: z.string().min(1).max(32_000),
  type: z.enum(['text', 'file', 'system']).default('text'),
  metadata: z.record(z.unknown()).default({}),
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  before: z.string().optional(), // message id cursor
});

const fileUploadBodySchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  category: z
    .enum(['asset_docs', 'legal', 'financial', 'offers', 'other'])
    .default('other'),
  fileBase64: z.string().min(1),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function messageRoutes(app: FastifyInstance) {
  // GET /deal-rooms/:roomId/messages
  app.get(
    '/deal-rooms/:roomId/messages',
    async (
      request: FastifyRequest<{ Params: { roomId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db);
      if (!participant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      const { limit, before } = paginationSchema.parse(request.query);

      let query = db
        .select()
        .from(messages)
        .where(eq(messages.dealRoomId, roomId))
        .orderBy(desc(messages.createdAt))
        .limit(limit);

      if (before) {
        const [cursorMsg] = await db
          .select({ createdAt: messages.createdAt })
          .from(messages)
          .where(eq(messages.id, before))
          .limit(1);

        if (cursorMsg?.createdAt) {
          query = db
            .select()
            .from(messages)
            .where(
              and(
                eq(messages.dealRoomId, roomId),
                lt(messages.createdAt, cursorMsg.createdAt),
              ),
            )
            .orderBy(desc(messages.createdAt))
            .limit(limit);
        }
      }

      const rows = await query;
      const symKey = getRoomSymKey();

      // Decrypt messages for the participant
      const decryptedMessages = await Promise.all(
        rows.map(async (msg) => {
          let decryptedContent: string | null = null;
          if (msg.ciphertext && msg.nonce) {
            try {
              decryptedContent = await decryptMessage(
                { ciphertext: msg.ciphertext, nonce: msg.nonce },
                symKey,
              );
            } catch {
              decryptedContent = msg.contentPreview ?? null;
            }
          }
          return {
            id: msg.id,
            dealRoomId: msg.dealRoomId,
            senderId: msg.senderId,
            type: msg.type,
            content: decryptedContent,
            contentPreview: msg.contentPreview,
            metadata: msg.metadata,
            readBy: msg.readBy,
            reactions: msg.reactions,
            createdAt: msg.createdAt,
          };
        }),
      );

      return ok(reply, {
        items: decryptedMessages.reverse(), // chronological order
        pagination: { limit, hasMore: rows.length === limit },
      });
    },
  );

  // POST /deal-rooms/:roomId/messages
  app.post(
    '/deal-rooms/:roomId/messages',
    async (
      request: FastifyRequest<{ Params: { roomId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db);
      if (!participant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      const parsed = sendMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return errRes(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const { content, type, metadata } = parsed.data;
      const symKey = getRoomSymKey();

      const encrypted = await encryptMessage(content, symKey);

      const [saved] = await db
        .insert(messages)
        .values({
          dealRoomId: roomId,
          senderId: userId,
          senderPublicKey: null,
          type: type as 'text' | 'file' | 'system' | 'nda' | 'offer',
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          contentPreview: content.slice(0, 80) + (content.length > 80 ? '…' : ''),
          metadata,
          deliveredTo: [],
          readBy: [],
          reactions: [],
        })
        .returning();

      // Update last_message_at on deal room
      await db
        .update(dealRooms)
        .set({ lastMessageAt: new Date(), updatedAt: new Date() })
        .where(eq(dealRooms.id, roomId));

      // Publish Redis event
      const redis = getRedis();
      await redis.set(
        `${CHANNEL_PREFIX}deal_room.message.sent`,
        JSON.stringify({
          roomId,
          messageId: saved?.id,
          senderId: userId,
          senderPseudonym: participant.pseudonym,
          type,
          contentPreview: saved?.contentPreview,
          timestamp: saved?.createdAt,
        }),
      );

      return ok(
        reply,
        {
          id: saved?.id,
          dealRoomId: roomId,
          senderId: userId,
          senderPseudonym: participant.pseudonym,
          type,
          content,
          contentPreview: saved?.contentPreview,
          metadata,
          createdAt: saved?.createdAt,
        },
        201,
      );
    },
  );

  // GET /deal-rooms/:roomId/files
  app.get(
    '/deal-rooms/:roomId/files',
    async (
      request: FastifyRequest<{ Params: { roomId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db);
      if (!participant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      const files = await db
        .select()
        .from(dealRoomFiles)
        .where(eq(dealRoomFiles.dealRoomId, roomId))
        .orderBy(desc(dealRoomFiles.createdAt));

      // Decrypt file names for participant
      const symKey = getRoomSymKey();
      const result = await Promise.all(
        files.map(async (f) => {
          let fileName = 'encrypted-file';
          try {
            const decoded = JSON.parse(
              Buffer.from(f.fileNameEncrypted, 'base64').toString('utf8'),
            ) as { ciphertext: string; nonce: string };
            fileName = await decryptSymmetric(decoded, symKey);
          } catch {
            fileName = 'encrypted-file';
          }

          return {
            id: f.id,
            dealRoomId: f.dealRoomId,
            uploadedBy: f.uploadedBy,
            category: f.category,
            fileName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            downloads: f.downloads,
            expiresAt: f.expiresAt,
            createdAt: f.createdAt,
          };
        }),
      );

      return ok(reply, { items: result });
    },
  );

  // POST /deal-rooms/:roomId/files — upload encrypted file
  app.post(
    '/deal-rooms/:roomId/files',
    async (
      request: FastifyRequest<{ Params: { roomId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db);
      if (!participant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      const parsed = fileUploadBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return errRes(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const { fileName, mimeType, category, fileBase64 } = parsed.data;

      // Decrypt the incoming file buffer
      const fileBuffer = Buffer.from(fileBase64, 'base64').buffer;
      const { encryptedBuffer, key: fileKey, nonce } = await encryptFile(fileBuffer);

      // Encrypt file name
      const symKey = getRoomSymKey();
      const encryptedName = await encryptSymmetric(fileName, symKey);
      const fileNameEncrypted = Buffer.from(JSON.stringify(encryptedName)).toString('base64');

      // Wrap the file key for each participant
      const allParticipants = await db
        .select({ userId: dealRoomParticipants.userId })
        .from(dealRoomParticipants)
        .where(eq(dealRoomParticipants.dealRoomId, roomId));

      // Get public keys for participants
      const participantUsers = await db
        .select({ id: users.id, publicKey: users.publicKey })
        .from(users)
        .where(
          eq(users.id, userId), // Simplified: in production, fetch all participant users
        );

      const wrappedKeys: Record<string, string> = {};
      for (const pu of participantUsers) {
        if (pu.publicKey) {
          try {
            // Use symmetric wrapping as a fallback if no keypair is available
            const wrappedKey = await encryptSymmetric(fileKey, symKey);
            wrappedKeys[pu.id] = Buffer.from(JSON.stringify(wrappedKey)).toString('base64');
          } catch {
            // skip if key wrapping fails for a participant
          }
        }
      }

      // Store encrypted file blob as base64 (in production: upload to S3)
      const encryptedBlob = Buffer.from(encryptedBuffer).toString('base64');
      const s3Key = `deal-rooms/${roomId}/files/${Date.now()}-${fileName.replace(/[^a-z0-9.]/gi, '_')}`;

      const [savedFile] = await db
        .insert(dealRoomFiles)
        .values({
          dealRoomId: roomId,
          uploadedBy: userId,
          category: category as 'asset_docs' | 'legal' | 'financial' | 'offers' | 'other',
          fileNameEncrypted,
          mimeType,
          s3Key,
          sizeBytes: Buffer.byteLength(fileBase64, 'base64'),
          nonce,
          wrappedKeys,
          encryptedBlobBase64: encryptedBlob,
          downloads: 0,
        })
        .returning();

      return ok(
        reply,
        {
          id: savedFile?.id,
          dealRoomId: roomId,
          uploadedBy: userId,
          category,
          fileName,
          mimeType,
          sizeBytes: savedFile?.sizeBytes,
          createdAt: savedFile?.createdAt,
        },
        201,
      );
    },
  );

  // GET /deal-rooms/:roomId/files/:fileId — download file
  app.get(
    '/deal-rooms/:roomId/files/:fileId',
    async (
      request: FastifyRequest<{ Params: { roomId: string; fileId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId, fileId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db);
      if (!participant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      const [file] = await db
        .select()
        .from(dealRoomFiles)
        .where(and(eq(dealRoomFiles.id, fileId), eq(dealRoomFiles.dealRoomId, roomId)))
        .limit(1);

      if (!file) {
        return errRes(reply, 'NOT_FOUND', 'File not found', 404);
      }

      if (!file.encryptedBlobBase64) {
        return errRes(reply, 'NOT_FOUND', 'File content not available', 404);
      }

      // Decrypt file name
      const symKey = getRoomSymKey();
      let fileName = 'download';
      try {
        const decoded = JSON.parse(
          Buffer.from(file.fileNameEncrypted, 'base64').toString('utf8'),
        ) as { ciphertext: string; nonce: string };
        fileName = await decryptSymmetric(decoded, symKey);
      } catch {
        // use default
      }

      // Unwrap file key from wrapped keys
      const wrappedKeyEntry = file.wrappedKeys[userId];
      let fileKey: string;

      if (wrappedKeyEntry) {
        try {
          const wrappedObj = JSON.parse(
            Buffer.from(wrappedKeyEntry, 'base64').toString('utf8'),
          ) as { ciphertext: string; nonce: string };
          fileKey = await decryptSymmetric(wrappedObj, symKey);
        } catch {
          return errRes(reply, 'DECRYPT_FAILED', 'Failed to unwrap file key', 500);
        }
      } else {
        return errRes(reply, 'FORBIDDEN', 'File key not available for your account', 403);
      }

      // Decrypt file content
      const encryptedBuffer = Buffer.from(file.encryptedBlobBase64, 'base64').buffer;
      let decryptedBuffer: ArrayBuffer;
      try {
        decryptedBuffer = await decryptFile(encryptedBuffer, fileKey, file.nonce);
      } catch {
        return errRes(reply, 'DECRYPT_FAILED', 'Failed to decrypt file', 500);
      }

      // Increment download count
      await db
        .update(dealRoomFiles)
        .set({ downloads: file.downloads + 1 })
        .where(eq(dealRoomFiles.id, fileId));

      reply.header('Content-Type', file.mimeType);
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
      return reply.send(Buffer.from(decryptedBuffer));
    },
  );

  // DELETE /deal-rooms/:roomId/messages/:messageId
  app.delete(
    '/deal-rooms/:roomId/messages/:messageId',
    async (
      request: FastifyRequest<{ Params: { roomId: string; messageId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId, messageId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db);
      if (!participant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      const [message] = await db
        .select({ senderId: messages.senderId, dealRoomId: messages.dealRoomId })
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.dealRoomId, roomId)))
        .limit(1);

      if (!message) {
        return errRes(reply, 'NOT_FOUND', 'Message not found', 404);
      }

      if (message.senderId !== userId) {
        return errRes(reply, 'FORBIDDEN', 'You can only delete your own messages', 403);
      }

      await db.delete(messages).where(eq(messages.id, messageId));

      return ok(reply, { deleted: true, messageId });
    },
  );

  // GET /deal-rooms/:roomId/suggestions — AI message suggestions
  app.get(
    '/deal-rooms/:roomId/suggestions',
    async (
      request: FastifyRequest<{ Params: { roomId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db);
      if (!participant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      // In production: forward to ai-service via HTTP or Redis event
      // Publish event to ai-service
      const redis = getRedis();
      await redis.set(
        `${CHANNEL_PREFIX}ai.suggestions.requested`,
        JSON.stringify({
          roomId,
          userId,
          requestedAt: new Date().toISOString(),
        }),
      );

      // Return placeholder suggestions while AI processes asynchronously
      const suggestions = [
        'Could you share the latest financials for this property?',
        'I would like to schedule a virtual viewing at your earliest convenience.',
        'Please confirm the timeline for the due diligence phase.',
        'Are there any outstanding planning permissions we should review?',
        'What are the terms for the earnest money deposit?',
      ];

      return ok(reply, {
        suggestions,
        source: 'static',
        note: 'AI-powered suggestions will be available once the ai-service processes this request.',
      });
    },
  );
}
