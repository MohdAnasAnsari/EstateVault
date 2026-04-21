import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { CallTypeEnum } from '@vault/types';
import { requireAuth } from '../lib/auth.js';
import { handleZodError, sendError } from '../lib/errors.js';
import {
  startCallLog,
  endCallLog,
  listCallLogs,
  mockGetICEServersConfig,
  CallError,
} from '../lib/calls.js';
import { z } from 'zod';

const StartCallInputSchema = z.object({
  callType: CallTypeEnum,
  participantIds: z.array(z.string().uuid()).min(1).max(10),
});

function handleCallError(reply: Parameters<typeof sendError>[0], error: unknown) {
  if (error instanceof ZodError) return handleZodError(reply, error);
  if (error instanceof CallError) {
    return sendError(reply, error.status, error.code, error.message);
  }
  throw error;
}

function serializeCallLog(row: Record<string, unknown>) {
  return {
    ...row,
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt,
    endedAt: row.endedAt instanceof Date ? (row.endedAt as Date).toISOString() : row.endedAt,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

export async function callRoutes(app: FastifyInstance) {
  // ICE server configuration
  app.get('/ice-servers', { preHandler: requireAuth }, async (_request, reply) => {
    return reply.send({ success: true, data: mockGetICEServersConfig() });
  });

  // List call logs for a deal room
  app.get('/deal-rooms/:dealRoomId/calls', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { dealRoomId } = request.params as { dealRoomId: string };
      const rows = await listCallLogs(dealRoomId, request.user.userId);
      return reply.send({ success: true, data: rows.map(serializeCallLog) });
    } catch (error) {
      return handleCallError(reply, error);
    }
  });

  // Start call (create call log)
  app.post('/deal-rooms/:dealRoomId/calls', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { dealRoomId } = request.params as { dealRoomId: string };
      const input = StartCallInputSchema.parse(request.body);
      const row = await startCallLog(
        dealRoomId,
        request.user.userId,
        input.callType,
        input.participantIds,
      );
      return reply.status(201).send({ success: true, data: serializeCallLog(row as unknown as Record<string, unknown>) });
    } catch (error) {
      return handleCallError(reply, error);
    }
  });

  // End call (update call log)
  app.patch('/logs/:callLogId/end', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { callLogId } = request.params as { callLogId: string };
      const row = await endCallLog(callLogId, request.user.userId);
      return reply.send({ success: true, data: serializeCallLog(row as unknown as Record<string, unknown>) });
    } catch (error) {
      return handleCallError(reply, error);
    }
  });
}
