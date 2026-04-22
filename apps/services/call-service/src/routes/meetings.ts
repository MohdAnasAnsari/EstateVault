import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb, meetingRequests, meetingAvailability, meetings } from '@vault/db';
import { eq, desc, and } from 'drizzle-orm';
import { generateIcal, findOverlappingSlots, formatMeetingTime } from '../lib/meetings.js';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createMeetingRequestSchema = z.object({
  dealRoomId: z.string().uuid(),
  meetingType: z.enum(['property_discussion', 'due_diligence', 'offer', 'virtual_viewing']),
  durationMinutes: z.number().int().min(15).max(480),
  timezone: z.string().min(1).max(100),
  proposedSlots: z.array(z.string().datetime()).min(1).max(20),
  expiresAt: z.string().datetime().optional(),
});

const submitAvailabilitySchema = z.object({
  slots: z.array(z.string().datetime()).min(1).max(20),
});

const confirmMeetingSchema = z.object({
  slot: z.string().datetime(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────

const meetingRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /meetings/requests
   * Create a meeting request with proposed time slots.
   */
  fastify.post('/requests', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const parsed = createMeetingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    const { dealRoomId, meetingType, durationMinutes, timezone, proposedSlots, expiresAt } = parsed.data;
    const db = getDb();

    const [meetingRequest] = await db
      .insert(meetingRequests)
      .values({
        dealRoomId,
        requestedBy: user.sub,
        meetingType,
        durationMinutes,
        timezone,
        status: 'pending',
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      })
      .returning();

    // Store the requester's own proposed slots as their availability
    if (meetingRequest) {
      await db.insert(meetingAvailability).values({
        meetingRequestId: meetingRequest.id,
        userId: user.sub,
        slots: proposedSlots,
      });
    }

    return reply.code(201).send({ success: true, data: meetingRequest });
  });

  /**
   * GET /meetings/requests
   * List all meeting requests (sent by current user or received in their deal rooms).
   */
  fastify.get('/requests', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const pagination = paginationSchema.safeParse(request.query);
    if (!pagination.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: pagination.error.message } });
    }

    const { page, limit } = pagination.data;
    const offset = (page - 1) * limit;
    const db = getDb();

    // Return all requests the user sent
    const requests = await db
      .select()
      .from(meetingRequests)
      .where(eq(meetingRequests.requestedBy, user.sub))
      .orderBy(desc(meetingRequests.createdAt))
      .limit(limit)
      .offset(offset);

    return reply.send({
      success: true,
      data: { requests, pagination: { page, limit } },
    });
  });

  /**
   * GET /meetings/requests/:id
   * Get details for a specific meeting request, including availability submissions.
   */
  fastify.get('/requests/:id', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { id } = request.params as { id: string };
    const db = getDb();

    const [meetingRequest] = await db
      .select()
      .from(meetingRequests)
      .where(eq(meetingRequests.id, id))
      .limit(1);

    if (!meetingRequest) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Meeting request not found' } });
    }

    const availability = await db
      .select()
      .from(meetingAvailability)
      .where(eq(meetingAvailability.meetingRequestId, id));

    return reply.send({
      success: true,
      data: { ...meetingRequest, availability },
    });
  });

  /**
   * POST /meetings/requests/:id/availability
   * Submit available time slots for a meeting request.
   */
  fastify.post('/requests/:id/availability', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { id } = request.params as { id: string };
    const parsed = submitAvailabilitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    const db = getDb();

    const [meetingRequest] = await db
      .select()
      .from(meetingRequests)
      .where(eq(meetingRequests.id, id))
      .limit(1);

    if (!meetingRequest) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Meeting request not found' } });
    }

    if (meetingRequest.status !== 'pending') {
      return reply.code(409).send({ success: false, error: { code: 'INVALID_STATUS', message: 'Meeting request is no longer pending' } });
    }

    // Upsert availability (unique constraint on meetingRequestId + userId)
    const [existing] = await db
      .select()
      .from(meetingAvailability)
      .where(
        and(
          eq(meetingAvailability.meetingRequestId, id),
          eq(meetingAvailability.userId, user.sub),
        ),
      )
      .limit(1);

    let record;
    if (existing) {
      [record] = await db
        .update(meetingAvailability)
        .set({ slots: parsed.data.slots, submittedAt: new Date() })
        .where(eq(meetingAvailability.id, existing.id))
        .returning();
    } else {
      [record] = await db
        .insert(meetingAvailability)
        .values({
          meetingRequestId: id,
          userId: user.sub,
          slots: parsed.data.slots,
        })
        .returning();
    }

    // Find overlapping slots across all submissions
    const allAvailability = await db
      .select()
      .from(meetingAvailability)
      .where(eq(meetingAvailability.meetingRequestId, id));

    let overlapping: string[] = [];
    if (allAvailability.length >= 2) {
      overlapping = allAvailability.reduce((acc, curr, idx) => {
        if (idx === 0) return curr.slots as string[];
        return findOverlappingSlots(acc, curr.slots as string[]);
      }, [] as string[]);
    }

    return reply.send({
      success: true,
      data: { record, overlappingSlots: overlapping },
    });
  });

  /**
   * POST /meetings/requests/:id/confirm
   * Confirm the meeting — picks a slot and creates a confirmed meeting record.
   */
  fastify.post('/requests/:id/confirm', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { id } = request.params as { id: string };
    const parsed = confirmMeetingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    const db = getDb();

    const [meetingRequest] = await db
      .select()
      .from(meetingRequests)
      .where(eq(meetingRequests.id, id))
      .limit(1);

    if (!meetingRequest) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Meeting request not found' } });
    }

    if (meetingRequest.requestedBy !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only the requester can confirm this meeting' } });
    }

    if (meetingRequest.status !== 'pending') {
      return reply.code(409).send({ success: false, error: { code: 'INVALID_STATUS', message: 'Meeting request is no longer pending' } });
    }

    const scheduledAt = new Date(parsed.data.slot);
    const icsUid = `${randomUUID()}@vault.example.com`;

    // Create confirmed meeting
    const [meeting] = await db
      .insert(meetings)
      .values({
        meetingRequestId: id,
        dealRoomId: meetingRequest.dealRoomId,
        meetingType: meetingRequest.meetingType,
        scheduledAt,
        durationMinutes: meetingRequest.durationMinutes,
        timezone: meetingRequest.timezone,
        icsUid,
        status: 'confirmed',
      })
      .returning();

    // Update request status to confirmed
    await db
      .update(meetingRequests)
      .set({ status: 'confirmed' })
      .where(eq(meetingRequests.id, id));

    return reply.code(201).send({ success: true, data: meeting });
  });

  /**
   * DELETE /meetings/requests/:id
   * Cancel a pending meeting request.
   */
  fastify.delete('/requests/:id', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { id } = request.params as { id: string };
    const db = getDb();

    const [meetingRequest] = await db
      .select()
      .from(meetingRequests)
      .where(eq(meetingRequests.id, id))
      .limit(1);

    if (!meetingRequest) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Meeting request not found' } });
    }

    if (meetingRequest.requestedBy !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only the requester can cancel this meeting request' } });
    }

    await db
      .update(meetingRequests)
      .set({ status: 'cancelled' })
      .where(eq(meetingRequests.id, id));

    return reply.send({ success: true, data: { cancelled: true, id } });
  });

  /**
   * GET /meetings/
   * List confirmed meetings for the current user.
   */
  fastify.get('/', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const pagination = paginationSchema.safeParse(request.query);
    if (!pagination.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: pagination.error.message } });
    }

    const { page, limit } = pagination.data;
    const offset = (page - 1) * limit;
    const db = getDb();

    // Get meetings from requests the user created
    const userRequests = await db
      .select({ id: meetingRequests.id })
      .from(meetingRequests)
      .where(eq(meetingRequests.requestedBy, user.sub));

    const requestIds = userRequests.map((r) => r.id);

    if (requestIds.length === 0) {
      return reply.send({ success: true, data: { meetings: [], pagination: { page, limit } } });
    }

    const confirmedMeetings = await db
      .select()
      .from(meetings)
      .where(eq(meetings.status, 'confirmed'))
      .orderBy(desc(meetings.scheduledAt))
      .limit(limit)
      .offset(offset);

    // Filter to user's meetings
    const userMeetings = confirmedMeetings.filter((m) =>
      requestIds.includes(m.meetingRequestId),
    );

    return reply.send({
      success: true,
      data: { meetings: userMeetings, pagination: { page, limit } },
    });
  });

  /**
   * GET /meetings/:meetingId
   * Get details for a specific confirmed meeting.
   */
  fastify.get('/:meetingId', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { meetingId } = request.params as { meetingId: string };
    const db = getDb();

    const [meeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingId))
      .limit(1);

    if (!meeting) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Meeting not found' } });
    }

    const formattedTime = formatMeetingTime(meeting.scheduledAt, meeting.timezone);

    return reply.send({
      success: true,
      data: { ...meeting, formattedTime },
    });
  });

  /**
   * GET /meetings/:meetingId/ical
   * Download an iCal (.ics) file for a confirmed meeting.
   */
  fastify.get('/:meetingId/ical', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { meetingId } = request.params as { meetingId: string };
    const db = getDb();

    const [meeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingId))
      .limit(1);

    if (!meeting) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Meeting not found' } });
    }

    try {
      const icsContent = generateIcal({
        id: meeting.id,
        icsUid: meeting.icsUid,
        meetingType: meeting.meetingType,
        scheduledAt: meeting.scheduledAt,
        durationMinutes: meeting.durationMinutes,
        timezone: meeting.timezone,
        dealRoomId: meeting.dealRoomId,
      });

      return reply
        .header('Content-Type', 'text/calendar; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="meeting-${meetingId}.ics"`)
        .send(icsContent);
    } catch (err) {
      request.log.error(err, 'iCal generation failed');
      return reply.code(500).send({ success: false, error: { code: 'ICAL_GENERATION_FAILED', message: 'Failed to generate iCal file' } });
    }
  });

  /**
   * DELETE /meetings/:meetingId
   * Cancel a confirmed meeting.
   */
  fastify.delete('/:meetingId', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { meetingId } = request.params as { meetingId: string };
    const db = getDb();

    const [meeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingId))
      .limit(1);

    if (!meeting) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Meeting not found' } });
    }

    if (meeting.status === 'cancelled') {
      return reply.code(409).send({ success: false, error: { code: 'ALREADY_CANCELLED', message: 'Meeting is already cancelled' } });
    }

    // Verify the user is the requester via meeting request
    const [meetingRequest] = await db
      .select()
      .from(meetingRequests)
      .where(eq(meetingRequests.id, meeting.meetingRequestId))
      .limit(1);

    const isRequester = meetingRequest?.requestedBy === user.sub;
    if (!isRequester && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions to cancel this meeting' } });
    }

    await db
      .update(meetings)
      .set({ status: 'cancelled' })
      .where(eq(meetings.id, meetingId));

    return reply.send({ success: true, data: { cancelled: true, id: meetingId } });
  });
};

export default meetingRoutes;
