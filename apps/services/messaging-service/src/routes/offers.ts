import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import { offers, dealRoomParticipants, users } from '@vault/db';
import { eq, and, desc } from 'drizzle-orm';
import { getRedis } from '@vault/cache';
import { encryptSymmetric, decryptSymmetric } from '@vault/crypto';

const CHANNEL_PREFIX = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(request: FastifyRequest): string {
  const id = request.headers['x-user-id'] as string | undefined;
  if (!id) throw new Error('X-User-Id header is required');
  return id;
}

function ok(reply: FastifyReply, data: unknown, statusCode = 200) {
  return reply.status(statusCode).send({ success: true, data });
}

function errRes(reply: FastifyReply, code: string, message: string, statusCode = 400) {
  return reply.status(statusCode).send({ success: false, error: { code, message } });
}

function getRoomSymKey(): string {
  const secret = process.env['NEXTAUTH_SECRET'] ?? 'change-me-32-bytes-long-padding!';
  return Buffer.from(secret.padEnd(32, '!').slice(0, 32)).toString('base64');
}

async function requireParticipant(
  userId: string,
  roomId: string,
  db: ReturnType<typeof getDb>,
) {
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

// ─── Schemas ──────────────────────────────────────────────────────────────────

const submitOfferSchema = z.object({
  amount: z.number().positive('Offer amount must be positive'),
  currency: z.string().length(3, 'Currency must be a 3-letter ISO code').default('AED'),
  conditions: z.string().max(10_000).default(''),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

const counterOfferSchema = z.object({
  action: z.enum(['counter', 'accept', 'reject']),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  conditions: z.string().max(10_000).optional(),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function offerRoutes(app: FastifyInstance) {
  // GET /deal-rooms/:roomId/offers
  app.get(
    '/deal-rooms/:roomId/offers',
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

      const offerRows = await db
        .select()
        .from(offers)
        .where(eq(offers.dealRoomId, roomId))
        .orderBy(desc(offers.createdAt));

      const symKey = getRoomSymKey();

      // Decrypt offer conditions for participant
      const decryptedOffers = await Promise.all(
        offerRows.map(async (offer) => {
          let conditions: string | null = null;
          try {
            conditions = await decryptSymmetric(
              {
                ciphertext: offer.conditionsCiphertext,
                nonce: offer.conditionsNonce,
              },
              symKey,
            );
          } catch {
            conditions = null;
          }

          return {
            id: offer.id,
            dealRoomId: offer.dealRoomId,
            parentOfferId: offer.parentOfferId,
            senderId: offer.senderId,
            amount: offer.amount,
            currency: offer.currency,
            conditions,
            status: offer.status,
            expiresAt: offer.expiresAt,
            createdAt: offer.createdAt,
            updatedAt: offer.updatedAt,
          };
        }),
      );

      return ok(reply, { items: decryptedOffers });
    },
  );

  // POST /deal-rooms/:roomId/offers — submit offer
  app.post(
    '/deal-rooms/:roomId/offers',
    async (
      request: FastifyRequest<{ Params: { roomId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId } = request.params;

      const parsed = submitOfferSchema.safeParse(request.body);
      if (!parsed.success) {
        return errRes(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const { amount, currency, conditions, expiresInDays } = parsed.data;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db);
      if (!participant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      const symKey = getRoomSymKey();
      const encryptedConditions = await encryptSymmetric(conditions, symKey);

      // Get user's public key
      const [userRow] = await db
        .select({ publicKey: users.publicKey })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const senderPublicKey = userRow?.publicKey ?? '';

      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : undefined;

      const [saved] = await db
        .insert(offers)
        .values({
          dealRoomId: roomId,
          senderId: userId,
          senderPublicKey,
          amount: String(amount),
          currency,
          conditionsCiphertext: encryptedConditions.ciphertext,
          conditionsNonce: encryptedConditions.nonce,
          status: 'submitted',
          ...(expiresAt ? { expiresAt } : {}),
        })
        .returning();

      // Publish event
      const redis = getRedis();
      await redis.set(
        `${CHANNEL_PREFIX}offer.submitted`,
        JSON.stringify({
          roomId,
          offerId: saved?.id,
          senderId: userId,
          senderPseudonym: participant.pseudonym,
          amount,
          currency,
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
          amount,
          currency,
          conditions,
          status: 'submitted',
          expiresAt: saved?.expiresAt,
          createdAt: saved?.createdAt,
        },
        201,
      );
    },
  );

  // PATCH /deal-rooms/:roomId/offers/:offerId — counter-offer / accept / reject
  app.patch(
    '/deal-rooms/:roomId/offers/:offerId',
    async (
      request: FastifyRequest<{ Params: { roomId: string; offerId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId, offerId } = request.params;

      const parsed = counterOfferSchema.safeParse(request.body);
      if (!parsed.success) {
        return errRes(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const { action, amount, currency, conditions, expiresInDays } = parsed.data;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db);
      if (!participant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      const [offer] = await db
        .select()
        .from(offers)
        .where(and(eq(offers.id, offerId), eq(offers.dealRoomId, roomId)))
        .limit(1);

      if (!offer) {
        return errRes(reply, 'NOT_FOUND', 'Offer not found', 404);
      }

      if (!['submitted', 'countered'].includes(offer.status)) {
        return errRes(reply, 'INVALID_STATE', `Cannot ${action} an offer in '${offer.status}' state`, 422);
      }

      if (action === 'accept' || action === 'reject') {
        const newStatus: 'accepted' | 'rejected' = action === 'accept' ? 'accepted' : 'rejected';

        const [updated] = await db
          .update(offers)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(offers.id, offerId))
          .returning();

        // Publish event
        const redis = getRedis();
        await redis.set(
          `${CHANNEL_PREFIX}offer.${action}ed`,
          JSON.stringify({
            roomId,
            offerId,
            action,
            byUserId: userId,
            byPseudonym: participant.pseudonym,
            timestamp: new Date().toISOString(),
          }),
        );

        return ok(reply, {
          id: updated?.id,
          status: updated?.status,
          updatedAt: updated?.updatedAt,
        });
      }

      // Counter-offer
      if (!amount) {
        return errRes(reply, 'VALIDATION_ERROR', 'amount is required for a counter-offer');
      }

      // Mark parent offer as countered
      await db
        .update(offers)
        .set({ status: 'countered', updatedAt: new Date() })
        .where(eq(offers.id, offerId));

      const symKey = getRoomSymKey();
      const encryptedConditions = conditions
        ? await encryptSymmetric(conditions, symKey)
        : await encryptSymmetric('', symKey);

      const [userRow] = await db
        .select({ publicKey: users.publicKey })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : undefined;

      const [counter] = await db
        .insert(offers)
        .values({
          dealRoomId: roomId,
          parentOfferId: offerId,
          senderId: userId,
          senderPublicKey: userRow?.publicKey ?? '',
          amount: String(amount),
          currency: currency ?? offer.currency,
          conditionsCiphertext: encryptedConditions.ciphertext,
          conditionsNonce: encryptedConditions.nonce,
          status: 'submitted',
          ...(expiresAt ? { expiresAt } : {}),
        })
        .returning();

      const redis = getRedis();
      await redis.set(
        `${CHANNEL_PREFIX}offer.submitted`,
        JSON.stringify({
          roomId,
          offerId: counter?.id,
          parentOfferId: offerId,
          senderId: userId,
          senderPseudonym: participant.pseudonym,
          amount,
          currency: currency ?? offer.currency,
          isCounter: true,
          timestamp: counter?.createdAt,
        }),
      );

      return ok(
        reply,
        {
          id: counter?.id,
          parentOfferId: offerId,
          dealRoomId: roomId,
          senderId: userId,
          senderPseudonym: participant.pseudonym,
          amount,
          currency: currency ?? offer.currency,
          conditions,
          status: 'submitted',
          isCounter: true,
          expiresAt: counter?.expiresAt,
          createdAt: counter?.createdAt,
        },
        201,
      );
    },
  );

  // GET /deal-rooms/:roomId/offers/:offerId — get offer details
  app.get(
    '/deal-rooms/:roomId/offers/:offerId',
    async (
      request: FastifyRequest<{ Params: { roomId: string; offerId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId, offerId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db);
      if (!participant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      const [offer] = await db
        .select()
        .from(offers)
        .where(and(eq(offers.id, offerId), eq(offers.dealRoomId, roomId)))
        .limit(1);

      if (!offer) {
        return errRes(reply, 'NOT_FOUND', 'Offer not found', 404);
      }

      const symKey = getRoomSymKey();
      let conditions: string | null = null;
      try {
        conditions = await decryptSymmetric(
          {
            ciphertext: offer.conditionsCiphertext,
            nonce: offer.conditionsNonce,
          },
          symKey,
        );
      } catch {
        conditions = null;
      }

      return ok(reply, {
        id: offer.id,
        dealRoomId: offer.dealRoomId,
        parentOfferId: offer.parentOfferId,
        senderId: offer.senderId,
        amount: offer.amount,
        currency: offer.currency,
        conditions,
        status: offer.status,
        expiresAt: offer.expiresAt,
        createdAt: offer.createdAt,
        updatedAt: offer.updatedAt,
      });
    },
  );
}
