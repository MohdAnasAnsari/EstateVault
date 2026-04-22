import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getDb, callLogs } from '@vault/db';
import { getRedis } from '@vault/cache';
import { eq, desc, and } from 'drizzle-orm';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const initiateCallSchema = z.object({
  dealRoomId: z.string().uuid(),
  callType: z.enum(['audio', 'video']),
  participantIds: z.array(z.string().uuid()).min(1).max(10),
});

const endCallSchema = z.object({
  durationSeconds: z.number().int().min(0).optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── ICE Config ───────────────────────────────────────────────────────────────

function getIceServersConfig() {
  const turnUrl = process.env['TURN_SERVER_URL'];
  const turnUsername = process.env['TURN_USERNAME'];
  const turnCredential = process.env['TURN_CREDENTIAL'];
  const stunUrl = process.env['STUN_SERVER_URL'] ?? 'stun:stun.l.google.com:19302';

  const servers: Array<{ urls: string; username?: string; credential?: string }> = [
    { urls: stunUrl },
  ];

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const callRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /calls/initiate
   * Initiate a new call — creates a callLog record and returns ICE servers.
   */
  fastify.post('/initiate', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const parsed = initiateCallSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    const { dealRoomId, callType, participantIds } = parsed.data;
    const db = getDb();

    const allParticipants = Array.from(new Set([user.sub, ...participantIds]));

    const [callLog] = await db
      .insert(callLogs)
      .values({
        dealRoomId,
        initiatedBy: user.sub,
        participants: allParticipants,
        callType,
        status: 'pending',
        startedAt: new Date(),
      })
      .returning();

    const iceServers = getIceServersConfig();

    return reply.code(201).send({
      success: true,
      data: {
        callId: callLog?.id,
        dealRoomId,
        callType,
        participants: allParticipants,
        iceServers,
        signalingNamespace: '/call-signal',
      },
    });
  });

  /**
   * GET /calls/ice-servers
   * Return the TURN/STUN server configuration.
   */
  fastify.get('/ice-servers', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    return reply.send({
      success: true,
      data: { iceServers: getIceServersConfig() },
    });
  });

  /**
   * GET /calls/
   * Get call history for the current authenticated user (paginated).
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

    // Fetch calls where the user is a participant
    // We use a raw query approach since jsonb array membership requires containment operator
    const allCalls = await db
      .select()
      .from(callLogs)
      .orderBy(desc(callLogs.createdAt))
      .limit(limit + 1)
      .offset(offset);

    // Filter in-memory for participant membership (jsonb contains check)
    const userCalls = allCalls.filter((c) =>
      Array.isArray(c.participants) && c.participants.includes(user.sub),
    );

    const hasMore = userCalls.length > limit;
    const results = hasMore ? userCalls.slice(0, limit) : userCalls;

    return reply.send({
      success: true,
      data: {
        calls: results,
        pagination: { page, limit, hasMore },
      },
    });
  });

  /**
   * GET /calls/:callId
   * Get details for a specific call.
   */
  fastify.get('/:callId', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { callId } = request.params as { callId: string };
    const db = getDb();

    const [call] = await db
      .select()
      .from(callLogs)
      .where(eq(callLogs.id, callId))
      .limit(1);

    if (!call) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Call not found' } });
    }

    // Ensure user is a participant or admin
    const isParticipant = Array.isArray(call.participants) && call.participants.includes(user.sub);
    if (!isParticipant && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'You are not a participant in this call' } });
    }

    return reply.send({ success: true, data: call });
  });

  /**
   * POST /calls/:callId/end
   * End an active call, update its duration and status, and publish the call.ended event.
   */
  fastify.post('/:callId/end', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { callId } = request.params as { callId: string };
    const parsed = endCallSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    const db = getDb();

    const [existing] = await db
      .select()
      .from(callLogs)
      .where(eq(callLogs.id, callId))
      .limit(1);

    if (!existing) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Call not found' } });
    }

    if (existing.status === 'ended') {
      return reply.code(409).send({ success: false, error: { code: 'ALREADY_ENDED', message: 'Call has already ended' } });
    }

    const endedAt = new Date();
    const durationSeconds =
      parsed.data.durationSeconds ??
      Math.floor((endedAt.getTime() - existing.startedAt.getTime()) / 1000);

    const [updated] = await db
      .update(callLogs)
      .set({ status: 'ended', endedAt, durationSeconds })
      .where(eq(callLogs.id, callId))
      .returning();

    // Publish call.ended event to Redis for AI summary generation
    try {
      const prefix = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';
      const redis = getRedis();
      const eventPayload = JSON.stringify({
        callId,
        dealRoomId: existing.dealRoomId,
        initiatedBy: existing.initiatedBy,
        participants: existing.participants,
        callType: existing.callType,
        durationSeconds,
        endedAt: endedAt.toISOString(),
      });
      // Redis publish — cast to any since cache package exposes a minimal client type
      await (redis as unknown as { publish(channel: string, message: string): Promise<number> })
        .publish(`${prefix}call.ended`, eventPayload);
    } catch (err) {
      request.log.warn(err, 'Failed to publish call.ended event');
    }

    return reply.send({ success: true, data: updated });
  });

  /**
   * GET /calls/deal-rooms/:roomId/calls
   * Get call history for a specific deal room.
   */
  fastify.get('/deal-rooms/:roomId/calls', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { roomId } = request.params as { roomId: string };
    const pagination = paginationSchema.safeParse(request.query);
    if (!pagination.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: pagination.error.message } });
    }

    const { page, limit } = pagination.data;
    const offset = (page - 1) * limit;
    const db = getDb();

    const calls = await db
      .select()
      .from(callLogs)
      .where(eq(callLogs.dealRoomId, roomId))
      .orderBy(desc(callLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return reply.send({
      success: true,
      data: {
        calls,
        pagination: { page, limit },
      },
    });
  });
};

export default callRoutes;
