import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import {
  listings,
  users,
  dealRooms,
  ndas,
  offers,
  kycSubmissions,
  adminAlerts,
  amlScreenings,
  listingMedia,
} from '@vault/db';
import { cacheGet, cacheSet } from '@vault/cache';
import { aiService } from '@vault/ai';
import { apiSuccess, apiError } from '@vault/types';
import { createLogger } from '@vault/logger';
import { eq, sql, and, gte, lte, count, desc, asc } from 'drizzle-orm';

const logger = createLogger('analytics-service:analytics');

interface RequestUser {
  id: string;
  role: string;
}

function requireAdmin(request: FastifyRequest, reply: FastifyReply): RequestUser | null {
  const userId = request.headers['x-user-id'] as string | undefined;
  const userRole = request.headers['x-user-role'] as string | undefined;

  if (!userId) {
    reply.code(401).send(apiError('UNAUTHORIZED', 'Authentication required'));
    return null;
  }

  if (userRole !== 'admin') {
    reply.code(403).send(apiError('FORBIDDEN', 'Admin access required'));
    return null;
  }

  return { id: userId, role: userRole };
}

const DateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  period: z.enum(['7d', '30d', '90d', '1y', 'all']).optional().default('30d'),
});

function getPeriodDate(period: string): Date {
  const now = new Date();
  switch (period) {
    case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d': return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case '1y': return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    default: return new Date(0);
  }
}

export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  // ── GET /dashboard — Platform overview ─────────────────────────────────────
  fastify.get('/dashboard', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const cacheKey = 'analytics:dashboard';
    const cached = await cacheGet(cacheKey);
    if (cached) return reply.send(apiSuccess(cached));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalListingsResult,
      totalUsersResult,
      totalDealRoomsResult,
      activeListingsResult,
      pendingKycResult,
      pendingListingsResult,
      amlFlagsResult,
      activeFraudResult,
      dailyActiveUsersResult,
      listingsCreatedTodayResult,
      dealRoomsOpenedResult,
      ndaSignedResult,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(listings),
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db.select({ count: sql<number>`count(*)::int` }).from(dealRooms),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(listings)
        .where(eq(listings.status, 'active')),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(kycSubmissions)
        .where(eq(kycSubmissions.status, 'submitted')),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(listings)
        .where(eq(listings.status, 'pending_review')),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(amlScreenings)
        .where(eq(amlScreenings.requiresReview, true)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(adminAlerts)
        .where(sql`${adminAlerts.resolvedAt} IS NULL`),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(gte(users.lastActiveAt, thirtyDaysAgo)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(listings)
        .where(gte(listings.createdAt, today)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(dealRooms)
        .where(gte(dealRooms.createdAt, thirtyDaysAgo)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(ndas)
        .where(eq(ndas.status, 'signed')),
    ]);

    const dashboard = {
      totalListings: totalListingsResult[0]?.count ?? 0,
      activeListings: activeListingsResult[0]?.count ?? 0,
      totalUsers: totalUsersResult[0]?.count ?? 0,
      totalDealRooms: totalDealRoomsResult[0]?.count ?? 0,
      pendingKyc: pendingKycResult[0]?.count ?? 0,
      pendingListings: pendingListingsResult[0]?.count ?? 0,
      amlFlags: amlFlagsResult[0]?.count ?? 0,
      activeFraudAlerts: activeFraudResult[0]?.count ?? 0,
      dailyActiveUsers: dailyActiveUsersResult[0]?.count ?? 0,
      listingsCreatedToday: listingsCreatedTodayResult[0]?.count ?? 0,
      dealRoomsOpened: dealRoomsOpenedResult[0]?.count ?? 0,
      ndaSigned: ndaSignedResult[0]?.count ?? 0,
      updatedAt: new Date().toISOString(),
    };

    await cacheSet(cacheKey, dashboard, 300); // 5 min cache
    return reply.send(apiSuccess(dashboard));
  });

  // ── GET /listings — Listing analytics ─────────────────────────────────────
  fastify.get('/listings', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const parsed = DateRangeSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }

    const { period, from, to } = parsed.data;
    const fromDate = from ? new Date(from) : getPeriodDate(period);
    const toDate = to ? new Date(to) : new Date();

    const cacheKey = `analytics:listings:${fromDate.toISOString()}:${toDate.toISOString()}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return reply.send(apiSuccess(cached));

    const [
      byStatus,
      byType,
      byCity,
      recentActivity,
    ] = await Promise.all([
      db
        .select({
          status: listings.status,
          count: sql<number>`count(*)::int`,
        })
        .from(listings)
        .groupBy(listings.status),
      db
        .select({
          assetType: listings.assetType,
          count: sql<number>`count(*)::int`,
          avgPrice: sql<number>`avg(${listings.priceAmount}::numeric)`,
        })
        .from(listings)
        .where(gte(listings.createdAt, fromDate))
        .groupBy(listings.assetType),
      db
        .select({
          city: listings.city,
          count: sql<number>`count(*)::int`,
          activeCount: sql<number>`count(*) filter (where ${listings.status} = 'active')::int`,
        })
        .from(listings)
        .groupBy(listings.city)
        .orderBy(sql`count(*) desc`)
        .limit(10),
      db
        .select({
          date: sql<string>`date_trunc('day', ${listings.createdAt})::text`,
          created: sql<number>`count(*)::int`,
        })
        .from(listings)
        .where(and(gte(listings.createdAt, fromDate), lte(listings.createdAt, toDate)))
        .groupBy(sql`date_trunc('day', ${listings.createdAt})`)
        .orderBy(sql`date_trunc('day', ${listings.createdAt}) asc`),
    ]);

    const result = {
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      byStatus,
      byType,
      byCity,
      recentActivity,
    };

    await cacheSet(cacheKey, result, 300);
    return reply.send(apiSuccess(result));
  });

  // ── GET /users — User analytics ────────────────────────────────────────────
  fastify.get('/users', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const parsed = DateRangeSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }

    const { period, from, to } = parsed.data;
    const fromDate = from ? new Date(from) : getPeriodDate(period);
    const toDate = to ? new Date(to) : new Date();

    const cacheKey = `analytics:users:${fromDate.toISOString()}:${toDate.toISOString()}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return reply.send(apiSuccess(cached));

    const [
      byRole,
      byTier,
      byKycStatus,
      registrations,
      kycConversion,
    ] = await Promise.all([
      db
        .select({ role: users.role, count: sql<number>`count(*)::int` })
        .from(users)
        .groupBy(users.role),
      db
        .select({ tier: users.accessTier, count: sql<number>`count(*)::int` })
        .from(users)
        .groupBy(users.accessTier),
      db
        .select({ status: users.kycStatus, count: sql<number>`count(*)::int` })
        .from(users)
        .groupBy(users.kycStatus),
      db
        .select({
          date: sql<string>`date_trunc('day', ${users.createdAt})::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(users)
        .where(and(gte(users.createdAt, fromDate), lte(users.createdAt, toDate)))
        .groupBy(sql`date_trunc('day', ${users.createdAt})`)
        .orderBy(sql`date_trunc('day', ${users.createdAt}) asc`),
      db
        .select({
          total: sql<number>`count(*)::int`,
          approved: sql<number>`count(*) filter (where ${users.kycStatus} = 'approved')::int`,
        })
        .from(users)
        .where(and(gte(users.createdAt, fromDate), lte(users.createdAt, toDate))),
    ]);

    const kycConversionRate =
      kycConversion[0]?.total && kycConversion[0].total > 0
        ? ((kycConversion[0].approved / kycConversion[0].total) * 100).toFixed(1)
        : '0';

    const result = {
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      byRole,
      byTier,
      byKycStatus,
      registrations,
      kycConversionRate: parseFloat(kycConversionRate),
    };

    await cacheSet(cacheKey, result, 300);
    return reply.send(apiSuccess(result));
  });

  // ── GET /deals — Deal analytics ────────────────────────────────────────────
  fastify.get('/deals', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const parsed = DateRangeSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }

    const { period, from, to } = parsed.data;
    const fromDate = from ? new Date(from) : getPeriodDate(period);
    const toDate = to ? new Date(to) : new Date();

    const cacheKey = `analytics:deals:${fromDate.toISOString()}:${toDate.toISOString()}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return reply.send(apiSuccess(cached));

    const [
      byStatus,
      createdOverTime,
      ndaStats,
      offerStats,
    ] = await Promise.all([
      db
        .select({
          status: dealRooms.status,
          count: sql<number>`count(*)::int`,
        })
        .from(dealRooms)
        .groupBy(dealRooms.status),
      db
        .select({
          date: sql<string>`date_trunc('day', ${dealRooms.createdAt})::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(dealRooms)
        .where(and(gte(dealRooms.createdAt, fromDate), lte(dealRooms.createdAt, toDate)))
        .groupBy(sql`date_trunc('day', ${dealRooms.createdAt})`)
        .orderBy(sql`date_trunc('day', ${dealRooms.createdAt}) asc`),
      db
        .select({
          status: ndas.status,
          count: sql<number>`count(*)::int`,
        })
        .from(ndas)
        .groupBy(ndas.status),
      db
        .select({
          status: offers.status,
          count: sql<number>`count(*)::int`,
          avgAmount: sql<number>`avg(${offers.amount}::numeric)`,
        })
        .from(offers)
        .where(gte(offers.createdAt, fromDate))
        .groupBy(offers.status),
    ]);

    const result = {
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      byStatus,
      createdOverTime,
      ndaStats,
      offerStats,
    };

    await cacheSet(cacheKey, result, 300);
    return reply.send(apiSuccess(result));
  });

  // ── GET /comparable-sales — Comparable sales analysis ─────────────────────
  fastify.get('/comparable-sales', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const QuerySchema = z.object({
      listingId: z.string().uuid(),
    });

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'listingId is required', parsed.error.flatten()));
    }

    const { listingId } = parsed.data;

    const db2 = getDb();
    const [listing] = await db2
      .select()
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);

    if (!listing) {
      return reply.code(404).send(apiError('NOT_FOUND', 'Listing not found'));
    }

    const cacheKey = `analytics:comparables:${listingId}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return reply.send(apiSuccess(cached));

    const result = await aiService.getComparableSales(
      listingId,
      listing.assetType,
      listing.city,
      listing.priceAmount ? parseFloat(listing.priceAmount) : null,
    );

    await cacheSet(cacheKey, result, 3600); // 1hr cache
    return reply.send(apiSuccess(result));
  });

  // ── GET /deal-health/:dealRoomId — Deal health score ──────────────────────
  fastify.get('/deal-health/:dealRoomId', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const { dealRoomId } = request.params as { dealRoomId: string };

    const [dealRoom] = await db
      .select()
      .from(dealRooms)
      .where(eq(dealRooms.id, dealRoomId))
      .limit(1);

    if (!dealRoom) {
      return reply.code(404).send(apiError('NOT_FOUND', 'Deal room not found'));
    }

    // Gather signals
    const now = new Date();
    const daysActive = Math.floor(
      (now.getTime() - dealRoom.createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    const lastMessageAt = dealRoom.lastMessageAt;
    const daysSinceLastMessage = lastMessageAt
      ? Math.floor((now.getTime() - lastMessageAt.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // Count docs uploaded
    const { dealRoomFiles, messages } = await import('@vault/db');

    const [filesResult, messagesResult, offersResult, meetingsResult] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(dealRoomFiles)
        .where(eq(dealRoomFiles.dealRoomId, dealRoomId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(messages)
        .where(eq(messages.dealRoomId, dealRoomId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(offers)
        .where(eq(offers.dealRoomId, dealRoomId)),
      db.execute(
        sql`SELECT count(*)::int as count FROM meetings WHERE deal_room_id = ${dealRoomId}`,
      ),
    ]);

    const docsUploaded = filesResult[0]?.count ?? 0;
    const totalMessages = messagesResult[0]?.count ?? 0;
    const offersSubmitted = offersResult[0]?.count ?? 0;
    const meetingsHeld = (meetingsResult as unknown as Array<{ count: number }>)[0]?.count ?? 0;

    const signals = {
      messagesCount: totalMessages,
      docsUploaded,
      offersSubmitted,
      meetingsHeld,
      daysSinceLastMessage,
      daysActive,
    };

    const healthScore = aiService.calculateDealHealth(signals);

    return reply.send(apiSuccess(healthScore));
  });
}
