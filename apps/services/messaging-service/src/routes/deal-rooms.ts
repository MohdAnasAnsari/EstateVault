import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import {
  dealRooms,
  dealRoomParticipants,
} from '@vault/db';
import { eq, and, or, desc } from 'drizzle-orm';
import { getRedis } from '@vault/cache';
import {
  generateRoomKeys,
  generatePseudonym,
  calculateDealHealth,
  advanceDealStage,
  type DealStage,
} from '../lib/deal-rooms.js';

const CHANNEL_PREFIX = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';

// ─── Schema validators ────────────────────────────────────────────────────────

const createDealRoomSchema = z.object({
  listingId: z.string().uuid(),
  sellerId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  ndaTemplateVersion: z.string().default('v1.0'),
});

const updateDealRoomSchema = z.object({
  fullAddressRevealed: z.boolean().optional(),
  commercialDataUnlocked: z.boolean().optional(),
});

const joinDealRoomSchema = z.object({
  ndaSignature: z.string().min(1, 'NDA signature is required'),
});

const addParticipantSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['buyer', 'seller', 'legal_advisor', 'agent', 'admin']),
  customPseudonym: z.string().max(80).optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ─── Auth helper ──────────────────────────────────────────────────────────────

function getUserId(request: FastifyRequest): string {
  const userId = request.headers['x-user-id'] as string | undefined;
  if (!userId) throw new Error('X-User-Id header is required');
  return userId;
}

function ok(reply: FastifyReply, data: unknown, statusCode = 200) {
  return reply.status(statusCode).send({ success: true, data });
}

function err(reply: FastifyReply, code: string, message: string, statusCode = 400) {
  return reply.status(statusCode).send({ success: false, error: { code, message } });
}

async function requireParticipant(
  userId: string,
  roomId: string,
  db: ReturnType<typeof getDb>,
  reply: FastifyReply,
): Promise<(typeof dealRoomParticipants.$inferSelect) | null> {
  const participant = await db
    .select()
    .from(dealRoomParticipants)
    .where(
      and(
        eq(dealRoomParticipants.dealRoomId, roomId),
        eq(dealRoomParticipants.userId, userId),
      ),
    )
    .limit(1);

  if (participant.length === 0) {
    err(reply, 'FORBIDDEN', 'You are not a participant of this deal room', 403);
    return null;
  }

  return participant[0] ?? null;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function dealRoomRoutes(app: FastifyInstance) {
  // POST / — create deal room
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);

    const parsed = createDealRoomSchema.safeParse(request.body);
    if (!parsed.success) {
      return err(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
    }

    const { listingId, sellerId, agentId, ndaTemplateVersion } = parsed.data;
    const db = getDb();

    if (userId === sellerId || userId === agentId) {
      return err(
        reply,
        'SELF_INTEREST_NOT_ALLOWED',
        'This listing is already managed by your account. Buyer deal rooms open when another qualified user expresses interest.',
        409,
      );
    }

    // Check if a room already exists for this listing+buyer pair
    const existing = await db
      .select({ id: dealRooms.id })
      .from(dealRooms)
      .where(
        and(eq(dealRooms.listingId, listingId), eq(dealRooms.buyerId, userId)),
      )
      .limit(1);

    if (existing.length > 0) {
      return err(reply, 'CONFLICT', 'A deal room already exists for this listing', 409);
    }

    // Generate room encryption keys
    const roomKeys = await generateRoomKeys();

    const [room] = await db
      .insert(dealRooms)
      .values({
        listingId,
        buyerId: userId,
        sellerId,
        agentId,
        createdById: userId,
        status: 'interest_expressed',
        ndaStatus: 'pending',
        fullAddressRevealed: false,
        commercialDataUnlocked: false,
        stageChangedAt: new Date(),
      })
      .returning();

    if (!room) {
      return err(reply, 'INTERNAL_ERROR', 'Failed to create deal room', 500);
    }

    // Add creator as participant with pseudonym
    const creatorPseudonym = generatePseudonym(userId, room.id);

    await db.insert(dealRoomParticipants).values({
      dealRoomId: room.id,
      userId,
      role: 'buyer',
      pseudonym: creatorPseudonym,
      identityRevealed: false,
      joinedAt: new Date(),
    });

    // Publish event
    const redis = getRedis();
    await redis.set(
      `${CHANNEL_PREFIX}deal_room.created`,
      JSON.stringify({
        roomId: room.id,
        listingId,
        buyerId: userId,
        sellerId,
        createdAt: room.createdAt,
      }),
    );

    return ok(
      reply,
      {
        room: {
          ...room,
          roomPublicKey: roomKeys.publicKey,
        },
        participant: {
          role: 'buyer',
          pseudonym: creatorPseudonym,
        },
        ndaTemplateVersion,
      },
      201,
    );
  });

  // GET / — list deal rooms for current user
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);

    const { page, limit } = paginationSchema.parse(request.query);
    const offset = (page - 1) * limit;
    const db = getDb();

    const userRooms = await db
      .select({
        room: dealRooms,
        participant: dealRoomParticipants,
      })
      .from(dealRooms)
      .innerJoin(
        dealRoomParticipants,
        and(
          eq(dealRoomParticipants.dealRoomId, dealRooms.id),
          eq(dealRoomParticipants.userId, userId),
        ),
      )
      .where(
        or(
          eq(dealRooms.buyerId, userId),
          eq(dealRooms.sellerId, userId),
          eq(dealRooms.agentId, userId),
        ),
      )
      .orderBy(desc(dealRooms.updatedAt))
      .limit(limit)
      .offset(offset);

    return ok(reply, {
      items: userRooms.map(({ room, participant }) => ({
        ...room,
        myRole: participant.role,
        myPseudonym: participant.pseudonym,
      })),
      pagination: { page, limit, hasMore: userRooms.length === limit },
    });
  });

  // GET /:roomId — get deal room details
  app.get(
    '/:roomId',
    async (request: FastifyRequest<{ Params: { roomId: string } }>, reply: FastifyReply) => {
      const userId = getUserId(request);
      const { roomId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db, reply);
      if (!participant) return;

      const [room] = await db
        .select()
        .from(dealRooms)
        .where(eq(dealRooms.id, roomId))
        .limit(1);

      if (!room) {
        return err(reply, 'NOT_FOUND', 'Deal room not found', 404);
      }

      const participants = await db
        .select()
        .from(dealRoomParticipants)
        .where(eq(dealRoomParticipants.dealRoomId, roomId));

      return ok(reply, {
        room,
        participants: participants.map((p) => ({
          id: p.id,
          role: p.role,
          pseudonym: p.pseudonym,
          identityRevealed: p.identityRevealed,
          joinedAt: p.joinedAt,
          lastSeenAt: p.lastSeenAt,
        })),
        myRole: participant.role,
        myPseudonym: participant.pseudonym,
      });
    },
  );

  // PATCH /:roomId — update deal room metadata (admin/owner only)
  app.patch(
    '/:roomId',
    async (request: FastifyRequest<{ Params: { roomId: string } }>, reply: FastifyReply) => {
      const userId = getUserId(request);
      const { roomId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db, reply);
      if (!participant) return;

      if (!['admin', 'agent', 'seller'].includes(participant.role)) {
        return err(reply, 'FORBIDDEN', 'Only admins, agents, or sellers can update deal room metadata', 403);
      }

      const parsed = updateDealRoomSchema.safeParse(request.body);
      if (!parsed.success) {
        return err(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const updates: Partial<typeof dealRooms.$inferInsert> = {};
      if (parsed.data.fullAddressRevealed !== undefined) {
        updates.fullAddressRevealed = parsed.data.fullAddressRevealed;
      }
      if (parsed.data.commercialDataUnlocked !== undefined) {
        updates.commercialDataUnlocked = parsed.data.commercialDataUnlocked;
      }
      updates.updatedAt = new Date();

      const [updated] = await db
        .update(dealRooms)
        .set(updates)
        .where(eq(dealRooms.id, roomId))
        .returning();

      return ok(reply, { room: updated });
    },
  );

  // POST /:roomId/join — join deal room with NDA signature
  app.post(
    '/:roomId/join',
    async (request: FastifyRequest<{ Params: { roomId: string } }>, reply: FastifyReply) => {
      const userId = getUserId(request);
      const { roomId } = request.params;

      const parsed = joinDealRoomSchema.safeParse(request.body);
      if (!parsed.success) {
        return err(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const db = getDb();

      // Check room exists
      const [room] = await db
        .select({ id: dealRooms.id, status: dealRooms.status })
        .from(dealRooms)
        .where(eq(dealRooms.id, roomId))
        .limit(1);

      if (!room) {
        return err(reply, 'NOT_FOUND', 'Deal room not found', 404);
      }

      // Check if already a participant
      const existing = await db
        .select({ id: dealRoomParticipants.id })
        .from(dealRoomParticipants)
        .where(
          and(
            eq(dealRoomParticipants.dealRoomId, roomId),
            eq(dealRoomParticipants.userId, userId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        return err(reply, 'CONFLICT', 'You are already a participant in this deal room', 409);
      }

      const pseudonym = generatePseudonym(userId, roomId);

      await db.insert(dealRoomParticipants).values({
        dealRoomId: roomId,
        userId,
        role: 'buyer',
        pseudonym,
        identityRevealed: false,
        joinedAt: new Date(),
      });

      return ok(reply, {
        roomId,
        pseudonym,
        role: 'buyer',
        joinedAt: new Date().toISOString(),
      });
    },
  );

  // POST /:roomId/advance-stage — advance deal stage
  app.post(
    '/:roomId/advance-stage',
    async (request: FastifyRequest<{ Params: { roomId: string } }>, reply: FastifyReply) => {
      const userId = getUserId(request);
      const { roomId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db, reply);
      if (!participant) return;

      if (!['admin', 'agent', 'seller', 'buyer'].includes(participant.role)) {
        return err(reply, 'FORBIDDEN', 'Insufficient permissions to advance deal stage', 403);
      }

      const [room] = await db
        .select({ status: dealRooms.status })
        .from(dealRooms)
        .where(eq(dealRooms.id, roomId))
        .limit(1);

      if (!room) {
        return err(reply, 'NOT_FOUND', 'Deal room not found', 404);
      }

      try {
        const newStage = await advanceDealStage(
          roomId,
          room.status as DealStage,
          userId,
          db,
        );

        const redis = getRedis();
        await redis.set(
          `${CHANNEL_PREFIX}deal_room.stage_advanced`,
          JSON.stringify({
            roomId,
            previousStage: room.status,
            newStage,
            advancedBy: userId,
            timestamp: new Date().toISOString(),
          }),
        );

        return ok(reply, {
          roomId,
          previousStage: room.status,
          newStage,
        });
      } catch (error) {
        return err(
          reply,
          'INVALID_TRANSITION',
          error instanceof Error ? error.message : 'Stage transition failed',
          422,
        );
      }
    },
  );

  // GET /:roomId/deal-health — get deal health score
  app.get(
    '/:roomId/deal-health',
    async (request: FastifyRequest<{ Params: { roomId: string } }>, reply: FastifyReply) => {
      const userId = getUserId(request);
      const { roomId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db, reply);
      if (!participant) return;

      const health = await calculateDealHealth(roomId, db);
      return ok(reply, health);
    },
  );

  // POST /:roomId/participants — add participant
  app.post(
    '/:roomId/participants',
    async (request: FastifyRequest<{ Params: { roomId: string } }>, reply: FastifyReply) => {
      const userId = getUserId(request);
      const { roomId } = request.params;
      const db = getDb();

      const requestingParticipant = await requireParticipant(userId, roomId, db, reply);
      if (!requestingParticipant) return;

      if (!['admin', 'agent', 'seller'].includes(requestingParticipant.role)) {
        return err(reply, 'FORBIDDEN', 'Only admins, agents, or sellers can add participants', 403);
      }

      const parsed = addParticipantSchema.safeParse(request.body);
      if (!parsed.success) {
        return err(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const { userId: newUserId, role, customPseudonym } = parsed.data;

      // Check if already a participant
      const existing = await db
        .select({ id: dealRoomParticipants.id })
        .from(dealRoomParticipants)
        .where(
          and(
            eq(dealRoomParticipants.dealRoomId, roomId),
            eq(dealRoomParticipants.userId, newUserId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        return err(reply, 'CONFLICT', 'User is already a participant in this deal room', 409);
      }

      const pseudonym = customPseudonym ?? generatePseudonym(newUserId, roomId);

      const [newParticipant] = await db
        .insert(dealRoomParticipants)
        .values({
          dealRoomId: roomId,
          userId: newUserId,
          role,
          pseudonym,
          identityRevealed: false,
          joinedAt: new Date(),
        })
        .returning();

      return ok(reply, { participant: newParticipant }, 201);
    },
  );
}
