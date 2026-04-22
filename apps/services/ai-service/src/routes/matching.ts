import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import { createLogger } from '@vault/logger';
import { eq, and, desc } from 'drizzle-orm';
import { refreshUserMatches } from '../lib/matching.js';

const logger = createLogger('ai-service:routes:matching');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { success: true as const, data };
}

function fail(code: string, message: string, status = 400) {
  return { success: false as const, error: { code, message }, _status: status };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const MatchActionBody = z.object({
  action: z.enum(['express_interest', 'save', 'dismiss']),
});

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export async function matchingRoutes(app: FastifyInstance): Promise<void> {
  async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    try {
      await req.jwtVerify();
      const payload = req.user as { sub?: string; userId?: string; id?: string };
      return payload.sub ?? payload.userId ?? payload.id ?? null;
    } catch {
      reply.status(401).send(fail('UNAUTHORIZED', 'Invalid or missing token', 401));
      return null;
    }
  }

  // GET /matches — get AI-matched listings for current user
  app.get('/', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const db = getDb();

    try {
      const { userMatches, listings } = await import('@vault/db');

      const matches = await db
        .select({
          id: userMatches.id,
          listingId: userMatches.listingId,
          score: userMatches.score,
          explanation: userMatches.explanation,
          dismissed: userMatches.dismissed,
          expressedInterest: userMatches.expressedInterest,
          saved: userMatches.saved,
          expiresAt: userMatches.expiresAt,
          createdAt: userMatches.createdAt,
          listing: {
            id: listings.id,
            title: listings.title,
            assetType: listings.assetType,
            city: listings.city,
            country: listings.country,
            priceAmount: listings.priceAmount,
            priceCurrency: listings.priceCurrency,
            priceOnRequest: listings.priceOnRequest,
            qualityTier: listings.qualityTier,
            titleDeedVerified: listings.titleDeedVerified,
            status: listings.status,
          },
        })
        .from(userMatches)
        .innerJoin(listings, eq(userMatches.listingId, listings.id))
        .where(
          and(
            eq(userMatches.userId, userId),
            eq(userMatches.dismissed, false),
          ),
        )
        .orderBy(desc(userMatches.score))
        .limit(20);

      return reply.send(ok({ matches, total: matches.length }));
    } catch (err) {
      logger.error({ err, userId }, 'Failed to fetch matches');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to fetch matches', 500));
    }
  });

  // GET /matches/:matchId — get match details
  app.get<{ Params: { matchId: string } }>(
    '/:matchId',
    async (req, reply) => {
      const userId = await authenticate(req, reply);
      if (!userId) return;

      const { matchId } = req.params;
      const db = getDb();

      try {
        const { userMatches, listings } = await import('@vault/db');

        const [match] = await db
          .select({
            id: userMatches.id,
            listingId: userMatches.listingId,
            score: userMatches.score,
            explanation: userMatches.explanation,
            dismissed: userMatches.dismissed,
            expressedInterest: userMatches.expressedInterest,
            saved: userMatches.saved,
            expiresAt: userMatches.expiresAt,
            createdAt: userMatches.createdAt,
            listing: {
              id: listings.id,
              title: listings.title,
              slug: listings.slug,
              assetType: listings.assetType,
              city: listings.city,
              country: listings.country,
              district: listings.district,
              priceAmount: listings.priceAmount,
              priceCurrency: listings.priceCurrency,
              priceOnRequest: listings.priceOnRequest,
              sizeSqm: listings.sizeSqm,
              bedrooms: listings.bedrooms,
              bathrooms: listings.bathrooms,
              description: listings.description,
              keyFeatures: listings.keyFeatures,
              titleDeedVerified: listings.titleDeedVerified,
              qualityTier: listings.qualityTier,
              sellerMotivation: listings.sellerMotivation,
              status: listings.status,
            },
          })
          .from(userMatches)
          .innerJoin(listings, eq(userMatches.listingId, listings.id))
          .where(
            and(
              eq(userMatches.id, matchId),
              eq(userMatches.userId, userId),
            ),
          )
          .limit(1);

        if (!match) {
          return reply.status(404).send(fail('NOT_FOUND', 'Match not found', 404));
        }

        // Score breakdown
        const breakdown = {
          totalScore: match.score,
          tier:
            match.score >= 80 ? 'excellent' :
            match.score >= 60 ? 'strong' :
            match.score >= 40 ? 'moderate' : 'weak',
          factors: {
            embeddingSimilarity: Math.round(match.score * 0.7),
            locationMatch: Math.round(match.score * 0.15),
            priceAlignment: Math.round(match.score * 0.15),
          },
        };

        return reply.send(ok({ ...match, breakdown }));
      } catch (err) {
        logger.error({ err, matchId }, 'Failed to fetch match details');
        return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to fetch match', 500));
      }
    },
  );

  // POST /matches/:matchId/action — record match action
  app.post<{ Params: { matchId: string } }>(
    '/:matchId/action',
    async (req, reply) => {
      const userId = await authenticate(req, reply);
      if (!userId) return;

      const { matchId } = req.params;

      const parsed = MatchActionBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          fail('VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', ')),
        );
      }

      const { action } = parsed.data;
      const db = getDb();

      try {
        const { userMatches } = await import('@vault/db');

        const [match] = await db
          .select()
          .from(userMatches)
          .where(
            and(eq(userMatches.id, matchId), eq(userMatches.userId, userId)),
          )
          .limit(1);

        if (!match) {
          return reply.status(404).send(fail('NOT_FOUND', 'Match not found', 404));
        }

        const updateData: Partial<{
          dismissed: boolean;
          expressedInterest: boolean;
          saved: boolean;
        }> = {};

        if (action === 'dismiss') updateData.dismissed = true;
        if (action === 'express_interest') updateData.expressedInterest = true;
        if (action === 'save') updateData.saved = true;

        await db
          .update(userMatches)
          .set(updateData)
          .where(eq(userMatches.id, matchId));

        logger.info({ matchId, userId, action }, 'Match action recorded');
        return reply.send(ok({ matchId, action, recorded: true }));
      } catch (err) {
        logger.error({ err, matchId, action }, 'Failed to record match action');
        return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to record action', 500));
      }
    },
  );

  // POST /matches/refresh — trigger re-computation of matches for current user
  app.post('/refresh', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    try {
      const db = getDb();
      const { Queue } = await import('bullmq');
      const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
      const parsed = new URL(redisUrl);
      const queue = new Queue('ai-matching', {
        connection: {
          host: parsed.hostname,
          port: parseInt(parsed.port || '6379', 10),
        },
      });

      await queue.add('refresh-matches', { userId });
      logger.info({ userId }, 'Match refresh queued');

      // Also do a synchronous refresh for immediate results
      await refreshUserMatches(userId, db);

      return reply.send(ok({ userId, status: 'queued', message: 'Match refresh initiated' }));
    } catch (err) {
      logger.error({ err, userId }, 'Failed to queue match refresh');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to refresh matches', 500));
    }
  });
}
