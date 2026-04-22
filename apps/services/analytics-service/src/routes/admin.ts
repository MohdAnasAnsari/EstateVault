import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import {
  users,
  kycSubmissions,
  listings,
  adminAlerts,
  auditLog,
  amlScreenings,
} from '@vault/db';
import { apiSuccess, apiError } from '@vault/types';
import { createLogger } from '@vault/logger';
import { eq, desc, asc, and, sql, gte, lte, ilike, or, isNull, isNotNull } from 'drizzle-orm';

const logger = createLogger('analytics-service:admin');

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

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  // ── GET /pending-kyc — List pending KYC submissions ────────────────────────
  fastify.get('/pending-kyc', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const parsed = PaginationSchema.safeParse(request.query);
    const { page, limit } = parsed.success ? parsed.data : { page: 1, limit: 20 };
    const offset = (page - 1) * limit;

    const [items, countResult] = await Promise.all([
      db
        .select({
          submission: kycSubmissions,
          user: {
            id: users.id,
            email: users.email,
            displayName: users.displayName,
            role: users.role,
            createdAt: users.createdAt,
          },
        })
        .from(kycSubmissions)
        .innerJoin(users, eq(kycSubmissions.userId, users.id))
        .where(eq(kycSubmissions.status, 'submitted'))
        .orderBy(asc(kycSubmissions.submittedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(kycSubmissions)
        .where(eq(kycSubmissions.status, 'submitted')),
    ]);

    const total = countResult[0]?.count ?? 0;

    return reply.send(
      apiSuccess({
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }),
    );
  });

  // ── GET /pending-listings — List listings pending review ───────────────────
  fastify.get('/pending-listings', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const QuerySchema = PaginationSchema.extend({
      sortBy: z.enum(['newest', 'oldest', 'quality_asc', 'quality_desc']).optional().default('newest'),
    });

    const parsed = QuerySchema.safeParse(request.query);
    const { page, limit, sortBy } = parsed.success
      ? parsed.data
      : { page: 1, limit: 20, sortBy: 'newest' as const };
    const offset = (page - 1) * limit;

    const sortMap = {
      newest: desc(listings.createdAt),
      oldest: asc(listings.createdAt),
      quality_asc: asc(listings.listingQualityScore),
      quality_desc: desc(listings.listingQualityScore),
    };

    const orderBy = sortMap[sortBy ?? 'newest'];

    const [items, countResult] = await Promise.all([
      db
        .select({
          listing: listings,
          seller: {
            id: users.id,
            email: users.email,
            displayName: users.displayName,
            kycStatus: users.kycStatus,
          },
        })
        .from(listings)
        .innerJoin(users, eq(listings.sellerId, users.id))
        .where(eq(listings.status, 'pending_review'))
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(listings)
        .where(eq(listings.status, 'pending_review')),
    ]);

    const total = countResult[0]?.count ?? 0;

    return reply.send(
      apiSuccess({
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }),
    );
  });

  // ── GET /alerts — List admin alerts ────────────────────────────────────────
  fastify.get('/alerts', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const QuerySchema = PaginationSchema.extend({
      type: z.enum(['fraud', 'aml', 'sanctions', 'pep', 'listing']).optional(),
      resolved: z.coerce.boolean().optional(),
    });

    const parsed = QuerySchema.safeParse(request.query);
    const { page, limit, type, resolved } = parsed.success
      ? parsed.data
      : { page: 1, limit: 20, type: undefined, resolved: undefined };
    const offset = (page - 1) * limit;

    const conditions = [];
    if (type) conditions.push(eq(adminAlerts.type, type));
    if (resolved === true) conditions.push(isNotNull(adminAlerts.resolvedAt));
    if (resolved === false) conditions.push(isNull(adminAlerts.resolvedAt));

    const [items, countResult] = await Promise.all([
      db
        .select()
        .from(adminAlerts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(adminAlerts.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(adminAlerts)
        .where(conditions.length > 0 ? and(...conditions) : undefined),
    ]);

    const total = countResult[0]?.count ?? 0;

    return reply.send(
      apiSuccess({
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }),
    );
  });

  // ── PATCH /alerts/:id/resolve — Resolve alert ──────────────────────────────
  fastify.patch('/alerts/:id/resolve', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };

    const [alert] = await db
      .select()
      .from(adminAlerts)
      .where(eq(adminAlerts.id, id))
      .limit(1);

    if (!alert) return reply.code(404).send(apiError('NOT_FOUND', 'Alert not found'));

    if (alert.resolvedAt) {
      return reply.code(409).send(apiError('ALREADY_RESOLVED', 'Alert is already resolved'));
    }

    const [updated] = await db
      .update(adminAlerts)
      .set({ resolvedAt: new Date() })
      .where(eq(adminAlerts.id, id))
      .returning();

    // Write audit log entry
    await db
      .insert(auditLog)
      .values({
        adminId: admin.id,
        action: 'resolve_alert',
        targetId: id,
        targetType: 'admin_alert',
        ip: (request.headers['x-forwarded-for'] as string) ?? null,
        metadata: { alertType: alert.type, alertTitle: alert.title },
      })
      .catch((err: unknown) => logger.error({ err }, 'Failed to write audit log'));

    logger.info({ alertId: id, adminId: admin.id }, 'Alert resolved');
    return reply.send(apiSuccess(updated));
  });

  // ── GET /audit-log — List audit log entries ────────────────────────────────
  fastify.get('/audit-log', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const QuerySchema = PaginationSchema.extend({
      action: z.string().optional(),
      targetType: z.string().optional(),
      adminId: z.string().uuid().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    });

    const parsed = QuerySchema.safeParse(request.query);
    const { page, limit, action, targetType, adminId, from, to } = parsed.success
      ? parsed.data
      : { page: 1, limit: 20, action: undefined, targetType: undefined, adminId: undefined, from: undefined, to: undefined };
    const offset = (page - 1) * limit;

    const conditions = [];
    if (action) conditions.push(ilike(auditLog.action, `%${action}%`));
    if (targetType) conditions.push(eq(auditLog.targetType, targetType));
    if (adminId) conditions.push(eq(auditLog.adminId, adminId));
    if (from) conditions.push(gte(auditLog.timestamp, new Date(from)));
    if (to) conditions.push(lte(auditLog.timestamp, new Date(to)));

    const [items, countResult] = await Promise.all([
      db
        .select({
          log: auditLog,
          admin: {
            id: users.id,
            email: users.email,
            displayName: users.displayName,
          },
        })
        .from(auditLog)
        .innerJoin(users, eq(auditLog.adminId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(auditLog.timestamp))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(conditions.length > 0 ? and(...conditions) : undefined),
    ]);

    const total = countResult[0]?.count ?? 0;

    return reply.send(
      apiSuccess({
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }),
    );
  });

  // ── GET /users — List all users with filters ───────────────────────────────
  fastify.get('/users', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const QuerySchema = PaginationSchema.extend({
      role: z.enum(['buyer', 'seller', 'agent', 'admin']).optional(),
      kycStatus: z.enum(['pending', 'submitted', 'approved', 'rejected']).optional(),
      accessTier: z.enum(['level_1', 'level_2', 'level_3']).optional(),
      search: z.string().optional(),
      sortBy: z.enum(['newest', 'oldest', 'email', 'last_active']).optional().default('newest'),
    });

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }

    const { page, limit, role, kycStatus, accessTier, search, sortBy } = parsed.data;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (role) conditions.push(eq(users.role, role));
    if (kycStatus) conditions.push(eq(users.kycStatus, kycStatus));
    if (accessTier) conditions.push(eq(users.accessTier, accessTier));
    if (search)
      conditions.push(
        or(ilike(users.email, `%${search}%`), ilike(users.displayName, `%${search}%`))!,
      );

    const sortMap = {
      newest: desc(users.createdAt),
      oldest: asc(users.createdAt),
      email: asc(users.email),
      last_active: desc(users.lastActiveAt),
    };
    const orderBy = sortMap[sortBy ?? 'newest'];

    const [items, countResult] = await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          role: users.role,
          accessTier: users.accessTier,
          kycStatus: users.kycStatus,
          reraVerified: users.reraVerified,
          totpEnabled: users.totpEnabled,
          lastActiveAt: users.lastActiveAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(conditions.length > 0 ? and(...conditions) : undefined),
    ]);

    const total = countResult[0]?.count ?? 0;

    return reply.send(
      apiSuccess({
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }),
    );
  });

  // ── PATCH /users/:id/tier — Update user access tier ───────────────────────
  fastify.patch('/users/:id/tier', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };

    const BodySchema = z.object({
      accessTier: z.enum(['level_1', 'level_2', 'level_3']),
      reason: z.string().max(500).optional(),
    });

    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten()));
    }

    const { accessTier, reason } = parsed.data;

    const [user] = await db.select({ id: users.id, accessTier: users.accessTier }).from(users).where(eq(users.id, id)).limit(1);
    if (!user) return reply.code(404).send(apiError('NOT_FOUND', 'User not found'));

    const [updated] = await db
      .update(users)
      .set({ accessTier, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id, accessTier: users.accessTier });

    await db
      .insert(auditLog)
      .values({
        adminId: admin.id,
        action: 'update_user_tier',
        targetId: id,
        targetType: 'user',
        ip: (request.headers['x-forwarded-for'] as string) ?? null,
        metadata: { previousTier: user.accessTier, newTier: accessTier, reason: reason ?? null },
      })
      .catch((err: unknown) => logger.error({ err }, 'Failed to write audit log'));

    logger.info({ userId: id, adminId: admin.id, accessTier }, 'User tier updated');
    return reply.send(apiSuccess(updated));
  });

  // ── PATCH /users/:id/role — Update user role ───────────────────────────────
  fastify.patch('/users/:id/role', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };

    const BodySchema = z.object({
      role: z.enum(['buyer', 'seller', 'agent', 'admin']),
      reason: z.string().max(500).optional(),
    });

    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten()));
    }

    const { role, reason } = parsed.data;

    const [user] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (!user) return reply.code(404).send(apiError('NOT_FOUND', 'User not found'));

    // Prevent self-demotion from admin
    if (admin.id === id && role !== 'admin') {
      return reply.code(400).send(apiError('INVALID_OPERATION', 'Cannot change your own admin role'));
    }

    const [updated] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id, role: users.role });

    await db
      .insert(auditLog)
      .values({
        adminId: admin.id,
        action: 'update_user_role',
        targetId: id,
        targetType: 'user',
        ip: (request.headers['x-forwarded-for'] as string) ?? null,
        metadata: { previousRole: user.role, newRole: role, reason: reason ?? null },
      })
      .catch((err: unknown) => logger.error({ err }, 'Failed to write audit log'));

    logger.info({ userId: id, adminId: admin.id, role }, 'User role updated');
    return reply.send(apiSuccess(updated));
  });
}
