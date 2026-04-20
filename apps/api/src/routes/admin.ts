import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { getDb } from '@vault/db';
import { adminAlerts, amlScreenings, kycSubmissions, listings, users } from '@vault/db/schema';
import {
  AdminUserUpdateInputSchema,
  KycReviewActionInputSchema,
  ListingReviewActionInputSchema,
} from '@vault/types';
import { requireAdmin } from '../lib/auth.js';
import { handleZodError, sendError } from '../lib/errors.js';
import { approveKycSubmission, rejectKycSubmission } from '../lib/kyc.js';
import { indexListingInSearch, logAdminAction } from '../lib/platform.js';
import {
  serializeAdminAlert,
  serializeAMLScreening,
  serializeKycSubmission,
  serializeListing,
  serializeUser,
} from '../lib/serializers.js';

function getIp(request: Parameters<FastifyInstance['get']>[1] extends never ? never : any): string | null {
  return request.ip ?? request.headers['x-forwarded-for']?.toString() ?? null;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const [pendingKycRow, pendingListingsRow, amlFlagsRow, fraudRow, dauRow, todayListingsRow] =
      await Promise.all([
        db.select({ value: count() }).from(kycSubmissions).where(eq(kycSubmissions.status, 'submitted')),
        db.select({ value: count() }).from(listings).where(eq(listings.verificationStatus, 'pending')),
        db.select({ value: count() }).from(amlScreenings).where(eq(amlScreenings.requiresReview, true)),
        db.select({ value: count() }).from(adminAlerts).where(and(eq(adminAlerts.type, 'fraud'), isNull(adminAlerts.resolvedAt))),
        db.select({ value: count() }).from(users).where(gte(users.lastActiveAt, dayStart)),
        db.select({ value: count() }).from(listings).where(gte(listings.createdAt, dayStart)),
      ]);

    return reply.send({
      success: true,
      data: {
        pendingKyc: pendingKycRow[0]?.value ?? 0,
        pendingListings: pendingListingsRow[0]?.value ?? 0,
        amlFlags: amlFlagsRow[0]?.value ?? 0,
        activeDeals: 12,
        activeFraudAlerts: fraudRow[0]?.value ?? 0,
        dailyActiveUsers: dauRow[0]?.value ?? 0,
        listingsCreatedToday: todayListingsRow[0]?.value ?? 0,
        dealRoomsOpened: 18,
        ndaSigned: 9,
      },
    });
  });

  app.get('/kyc', { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();
    const rows = await db
      .select({
        submission: kycSubmissions,
        user: users,
      })
      .from(kycSubmissions)
      .innerJoin(users, eq(kycSubmissions.userId, users.id))
      .where(eq(kycSubmissions.status, 'submitted'))
      .orderBy(desc(kycSubmissions.submittedAt));

    return reply.send({
      success: true,
      data: rows.map((row) => ({
        submission: serializeKycSubmission(row.submission),
        user: serializeUser(row.user),
      })),
    });
  });

  app.post('/kyc/:userId/review', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };
      const input = KycReviewActionInputSchema.parse(request.body);

      if (input.decision === 'approved') {
        await approveKycSubmission(userId, input.reason);
      } else {
        await rejectKycSubmission(userId, input.reason);
      }

      await logAdminAction({
        adminId: request.user.userId,
        action: `kyc_${input.decision}`,
        targetId: userId,
        targetType: 'user',
        ip: getIp(request),
        metadata: { reason: input.reason ?? null },
      });

      return reply.send({ success: true, data: { reviewed: true } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.get('/listings/pending', { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();
    const rows = await db
      .select({
        listing: listings,
        seller: users,
      })
      .from(listings)
      .innerJoin(users, eq(listings.sellerId, users.id))
      .where(sql`${listings.verificationStatus} in ('pending', 'changes_requested')`)
      .orderBy(desc(listings.updatedAt));

    return reply.send({
      success: true,
      data: rows.map((row) => ({
        listing: serializeListing(row.listing),
        seller: serializeUser(row.seller),
      })),
    });
  });

  app.post('/listings/:listingId/review', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { listingId } = request.params as { listingId: string };
      const input = ListingReviewActionInputSchema.parse(request.body);
      const db = getDb();
      const [existing] = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);

      if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

      const nextStatus =
        input.decision === 'approved'
          ? 'active'
          : input.decision === 'changes_requested'
            ? 'pending_review'
            : 'withdrawn';
      const verificationStatus =
        input.decision === 'approved'
          ? 'verified'
          : input.decision === 'changes_requested'
            ? 'changes_requested'
            : 'rejected';

      const [updated] = await db
        .update(listings)
        .set({
          status: nextStatus,
          verificationStatus,
          sellerVerificationFeedback: input.feedback ?? null,
          qualityTierOverride: input.qualityTierOverride ?? existing.qualityTierOverride,
          updatedAt: new Date(),
        })
        .where(eq(listings.id, listingId))
        .returning();

      if (!updated) return sendError(reply, 500, 'UPDATE_FAILED', 'Failed to review listing');

      if (input.decision === 'approved') {
        await indexListingInSearch(serializeListing(updated));
      }

      const [fresh] = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);

      const [seller] = await db.select().from(users).where(eq(users.id, updated.sellerId)).limit(1);
      if (seller) {
        await logAdminAction({
          adminId: request.user.userId,
          action: `listing_${input.decision}`,
          targetId: listingId,
          targetType: 'listing',
          ip: getIp(request),
          metadata: { feedback: input.feedback ?? null, qualityTierOverride: input.qualityTierOverride ?? null },
        });
      }

      return reply.send({ success: true, data: serializeListing(fresh ?? updated) });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.get('/compliance', { preHandler: requireAdmin }, async (_request, reply) => {
    const db = getDb();
    const [amlRows, alertRows] = await Promise.all([
      db.select().from(amlScreenings).orderBy(desc(amlScreenings.screenedAt)).limit(50),
      db.select().from(adminAlerts).orderBy(desc(adminAlerts.createdAt)).limit(50),
    ]);

    return reply.send({
      success: true,
      data: {
        aml: amlRows.map(serializeAMLScreening),
        alerts: alertRows.map(serializeAdminAlert),
      },
    });
  });

  app.get('/users', { preHandler: requireAdmin }, async (request, reply) => {
    const q = (request.query as { q?: string }).q?.trim();
    const db = getDb();
    const rows = q
      ? await db
          .select()
          .from(users)
          .where(sql`${users.email} ilike ${`%${q}%`} or ${users.displayName} ilike ${`%${q}%`}`)
          .orderBy(desc(users.createdAt))
      : await db.select().from(users).orderBy(desc(users.createdAt)).limit(100);

    return reply.send({ success: true, data: rows.map(serializeUser) });
  });

  app.patch('/users/:userId', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };
      const input = AdminUserUpdateInputSchema.parse(request.body);
      const db = getDb();

      const [updated] = await db
        .update(users)
        .set({
          accessTier: input.accessTier,
          kycStatus: input.kycStatus,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      if (!updated) return sendError(reply, 404, 'NOT_FOUND', 'User not found');

      await logAdminAction({
        adminId: request.user.userId,
        action: 'user_access_adjusted',
        targetId: userId,
        targetType: 'user',
        ip: getIp(request),
        metadata: input,
      });

      return reply.send({ success: true, data: serializeUser(updated) });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.post('/users/:userId/impersonate', { preHandler: requireAdmin }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return sendError(reply, 404, 'NOT_FOUND', 'User not found');

    const token = app.jwt.sign({
      userId: user.id,
      role: user.role,
      accessTier: user.accessTier,
    });

    await logAdminAction({
      adminId: request.user.userId,
      action: 'impersonate_user',
      targetId: userId,
      targetType: 'user',
      ip: getIp(request),
    });

    return reply.send({ success: true, data: { token, user: serializeUser(user) } });
  });
}
