import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  CreateMeetingRequestInputSchema,
  SubmitAvailabilityInputSchema,
} from '@vault/types';
import { requireAuth } from '../lib/auth.js';
import { handleZodError, sendError } from '../lib/errors.js';
import {
  createMeetingRequest,
  submitAvailability,
  getMeetingRequestDetail,
  listDealRoomMeetingRequests,
  cancelMeetingRequest,
  generateICS,
  MeetingError,
} from '../lib/meetings.js';
import { getDb, meetings } from '@vault/db';
import { eq } from 'drizzle-orm';

function handleMeetingError(reply: Parameters<typeof sendError>[0], error: unknown) {
  if (error instanceof ZodError) return handleZodError(reply, error);
  if (error instanceof MeetingError) {
    return sendError(reply, error.status, error.code, error.message);
  }
  throw error;
}

export async function meetingRoutes(app: FastifyInstance) {
  // List meeting requests for a deal room
  app.get('/deal-rooms/:dealRoomId/meetings', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { dealRoomId } = request.params as { dealRoomId: string };
      const rows = await listDealRoomMeetingRequests(dealRoomId, request.user.userId);
      return reply.send({
        success: true,
        data: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt?.toISOString() ?? null,
        })),
      });
    } catch (error) {
      return handleMeetingError(reply, error);
    }
  });

  // Create meeting request
  app.post('/deal-rooms/:dealRoomId/meetings', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { dealRoomId } = request.params as { dealRoomId: string };
      const input = CreateMeetingRequestInputSchema.parse(request.body);
      const row = await createMeetingRequest(dealRoomId, request.user.userId, input);
      return reply.status(201).send({
        success: true,
        data: {
          ...row,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt?.toISOString() ?? null,
        },
      });
    } catch (error) {
      return handleMeetingError(reply, error);
    }
  });

  // Get meeting request detail
  app.get('/requests/:meetingRequestId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { meetingRequestId } = request.params as { meetingRequestId: string };
      const detail = await getMeetingRequestDetail(meetingRequestId, request.user.userId);
      return reply.send({
        success: true,
        data: {
          ...detail,
          createdAt: detail.createdAt.toISOString(),
          expiresAt: detail.expiresAt?.toISOString() ?? null,
          myAvailability: detail.myAvailability
            ? { ...detail.myAvailability, submittedAt: detail.myAvailability.submittedAt.toISOString() }
            : null,
          confirmedMeeting: detail.confirmedMeeting
            ? {
                ...detail.confirmedMeeting,
                scheduledAt: detail.confirmedMeeting.scheduledAt.toISOString(),
                createdAt: detail.confirmedMeeting.createdAt.toISOString(),
              }
            : null,
        },
      });
    } catch (error) {
      return handleMeetingError(reply, error);
    }
  });

  // Submit availability
  app.post('/requests/:meetingRequestId/availability', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { meetingRequestId } = request.params as { meetingRequestId: string };
      const input = SubmitAvailabilityInputSchema.parse(request.body);
      const result = await submitAvailability(
        meetingRequestId,
        request.user.userId,
        input.slots,
      );
      return reply.status(201).send({
        success: true,
        data: {
          availability: {
            ...result.availability,
            submittedAt: result.availability.submittedAt.toISOString(),
          },
          confirmedMeeting: result.confirmedMeeting
            ? {
                ...result.confirmedMeeting,
                scheduledAt: result.confirmedMeeting.scheduledAt.toISOString(),
                createdAt: result.confirmedMeeting.createdAt.toISOString(),
              }
            : null,
        },
      });
    } catch (error) {
      return handleMeetingError(reply, error);
    }
  });

  // Download ICS for a confirmed meeting
  app.get('/confirmed/:meetingId/ics', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { meetingId } = request.params as { meetingId: string };
      const db = getDb();
      const [meeting] = await db
        .select()
        .from(meetings)
        .where(eq(meetings.id, meetingId))
        .limit(1);

      if (!meeting) return sendError(reply, 404, 'NOT_FOUND', 'Meeting not found');

      const ics = generateICS(meeting);
      return reply
        .header('Content-Type', 'text/calendar; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="vault-meeting.ics"')
        .send(ics);
    } catch (error) {
      return handleMeetingError(reply, error);
    }
  });

  // Cancel meeting request
  app.post('/requests/:meetingRequestId/cancel', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { meetingRequestId } = request.params as { meetingRequestId: string };
      const row = await cancelMeetingRequest(meetingRequestId, request.user.userId);
      if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Meeting request not found');
      return reply.send({
        success: true,
        data: {
          ...row,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt?.toISOString() ?? null,
        },
      });
    } catch (error) {
      return handleMeetingError(reply, error);
    }
  });
}
