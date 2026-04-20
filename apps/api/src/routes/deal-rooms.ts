import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { aiService } from '@vault/ai';
import {
  AddMessageReactionInputSchema,
  AnalyseDealRoomDocumentInputSchema,
  CreateOfferInputSchema,
  SetMessageExpiryInputSchema,
  SignNDAInputSchema,
  UploadDealRoomFileInputSchema,
} from '@vault/types';
import { requireAuth } from '../lib/auth.js';
import {
  addDealRoomMessageReaction,
  createDealRoomFile,
  createOfferThread,
  DealRoomError,
  getOrCreateDealRoomForListing,
  getDealRoomAssistantSuggestion,
  getDealRoomDetail,
  getDealRoomFileForUser,
  incrementDealRoomFileDownloads,
  listUserDealRooms,
  markDealRoomMessageRead,
  setDealRoomMessageExpiry,
  signDealRoomNda,
} from '../lib/deal-rooms.js';
import {
  emitDealRoomMessage,
  emitDealRoomPresence,
  emitDealRoomStageChange,
  getOnlineUserIdsForDealRoom,
} from '../lib/deal-room-realtime.js';
import { handleZodError, sendError } from '../lib/errors.js';

function handleDealRoomError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) return handleZodError(reply, error);
  if (error instanceof DealRoomError) {
    return sendError(reply, error.status, error.code, error.message);
  }

  throw error;
}

export async function dealRoomRoutes(app: FastifyInstance) {
  app.post('/from-listing/:listingId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { listingId } = request.params as { listingId: string };
      const room = await getOrCreateDealRoomForListing(listingId, request.user.userId);
      return reply.status(201).send({ success: true, data: room });
    } catch (error) {
      return handleDealRoomError(reply, error);
    }
  });

  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const rooms = await listUserDealRooms(request.user.userId);
      return reply.send({ success: true, data: rooms });
    } catch (error) {
      return handleDealRoomError(reply, error);
    }
  });

  app.get('/:id', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const room = await getDealRoomDetail(
        id,
        request.user.userId,
        getOnlineUserIdsForDealRoom(id),
      );

      return reply.send({ success: true, data: room });
    } catch (error) {
      return handleDealRoomError(reply, error);
    }
  });

  app.post('/:id/nda/sign', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const payload = SignNDAInputSchema.parse(request.body);
      const result = await signDealRoomNda({
        dealRoomId: id,
        userId: request.user.userId,
        payload,
      });

      emitDealRoomMessage(result.systemMessage);
      await emitDealRoomPresence(id);

      if (result.stageChanged) {
        emitDealRoomStageChange(id, {
          newStatus: result.stageChanged,
          systemMessage: result.systemMessage.contentPreview ?? 'Room stage updated',
        });
      }

      return reply.send({ success: true, data: result.nda });
    } catch (error) {
      return handleDealRoomError(reply, error);
    }
  });

  app.post('/:id/offers', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const payload = CreateOfferInputSchema.parse(request.body);
      const result = await createOfferThread({
        dealRoomId: id,
        senderId: request.user.userId,
        payload,
      });

      emitDealRoomMessage(result.systemMessage);
      emitDealRoomStageChange(id, {
        newStatus: result.stageChanged,
        systemMessage: result.systemMessage.contentPreview ?? 'Offer activity updated',
      });

      return reply.status(201).send({ success: true, data: result.offer });
    } catch (error) {
      return handleDealRoomError(reply, error);
    }
  });

  app.post('/:id/files', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const payload = UploadDealRoomFileInputSchema.parse(request.body);
      const result = await createDealRoomFile({
        dealRoomId: id,
        uploadedBy: request.user.userId,
        payload,
      });

      emitDealRoomMessage(result.message);
      return reply.status(201).send({ success: true, data: result.file });
    } catch (error) {
      return handleDealRoomError(reply, error);
    }
  });

  app.get('/:id/files/:fileId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id, fileId } = request.params as { id: string; fileId: string };
      const file = await incrementDealRoomFileDownloads(id, fileId, request.user.userId);
      return reply.send({
        success: true,
        data: {
          ...file,
          watermarkText: `Downloaded by ${request.user.userId} on ${new Date().toISOString()} · VAULT Confidential`,
        },
      });
    } catch (error) {
      return handleDealRoomError(reply, error);
    }
  });

  app.post('/:id/files/:fileId/analyse', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id, fileId } = request.params as { id: string; fileId: string };
      const payload = AnalyseDealRoomDocumentInputSchema.parse(request.body);
      await getDealRoomFileForUser(id, fileId, request.user.userId);
      const analysis = await aiService.analyseDealRoomDocument(payload.base64Content, payload.fileType);
      return reply.send({ success: true, data: analysis });
    } catch (error) {
      return handleDealRoomError(reply, error);
    }
  });

  app.post('/:id/assistant', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const suggestion = await getDealRoomAssistantSuggestion(id, request.user.userId);
      return reply.send({ success: true, data: suggestion });
    } catch (error) {
      return handleDealRoomError(reply, error);
    }
  });

  app.post('/:id/messages/:messageId/read', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { messageId } = request.params as { id: string; messageId: string };
      const message = await markDealRoomMessageRead(messageId, request.user.userId);
      return reply.send({ success: true, data: message });
    } catch (error) {
      return handleDealRoomError(reply, error);
    }
  });

  app.post('/:id/messages/:messageId/reactions', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { messageId } = request.params as { id: string; messageId: string };
      const payload = AddMessageReactionInputSchema.parse(request.body);
      const message = await addDealRoomMessageReaction(messageId, request.user.userId, payload);
      return reply.send({ success: true, data: message });
    } catch (error) {
      return handleDealRoomError(reply, error);
    }
  });

  app.post('/:id/messages/:messageId/expiry', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { messageId } = request.params as { id: string; messageId: string };
      const payload = SetMessageExpiryInputSchema.parse(request.body);
      const message = await setDealRoomMessageExpiry(
        messageId,
        request.user.userId,
        payload.expiresInHours,
      );
      return reply.send({ success: true, data: message });
    } catch (error) {
      return handleDealRoomError(reply, error);
    }
  });
}
