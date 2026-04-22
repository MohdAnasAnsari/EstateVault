import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, inArray, or, desc, sql } from 'drizzle-orm';
import { ZodError, z } from 'zod';
import { getDb } from '@vault/db';
import { users } from '@vault/db/schema';
import { GenerateKeysInputSchema, UpdateProfileInputSchema } from '@vault/types';
import { requireAuth, requireAdmin } from '../lib/auth.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return reply.status(status).send({
    success: false,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  });
}

function handleZodError(reply: FastifyReply, err: ZodError) {
  return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid input', err.flatten());
}

type DbUser = typeof users.$inferSelect;

function serializeUser(row: DbUser) {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    phone: row.phone ?? null,
    phoneVerified: row.phoneVerified,
    role: row.role,
    accessTier: row.accessTier,
    displayName: row.displayName ?? null,
    avatarUrl: row.avatarUrl ?? null,
    kycStatus: row.kycStatus,
    reraOrn: row.reraOrn ?? null,
    reraVerified: row.reraVerified,
    nationality: row.nationality ?? null,
    reraLicenseExpiry: row.reraLicenseExpiry?.toISOString() ?? null,
    preferredCurrency: row.preferredCurrency,
    preferredLanguage: row.preferredLanguage,
    publicKey: row.publicKey ?? null,
    hasVaultKeys: Boolean(row.publicKey && row.encryptedPrivateKey),
    stripeCustomerId: row.stripeCustomerId ?? null,
    stripeSubscriptionId: row.stripeSubscriptionId ?? null,
    expoPushToken: row.expoPushToken ?? null,
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializePublicUser(row: DbUser) {
  return {
    id: row.id,
    displayName: row.displayName ?? null,
    avatarUrl: row.avatarUrl ?? null,
    role: row.role,
    reraOrn: row.reraOrn ?? null,
    reraVerified: row.reraVerified,
    publicKey: row.publicKey ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── User routes ──────────────────────────────────────────────────────────────

export async function userRoutes(app: FastifyInstance) {
  // ─── GET /me ────────────────────────────────────────────────────────────
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, request.user.userId))
      .limit(1);

    if (!user) return sendError(reply, 404, 'NOT_FOUND', 'User not found');
    return reply.send({ success: true, data: serializeUser(user) });
  });

  // ─── PATCH /me ──────────────────────────────────────────────────────────
  app.patch('/me', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = UpdateProfileInputSchema.parse(request.body);
      const db = getDb();

      const [updated] = await db
        .update(users)
        .set({
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.preferredCurrency !== undefined ? { preferredCurrency: input.preferredCurrency } : {}),
          ...(input.preferredLanguage !== undefined ? { preferredLanguage: input.preferredLanguage } : {}),
          ...(input.expoPushToken !== undefined ? { expoPushToken: input.expoPushToken } : {}),
          ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, request.user.userId))
        .returning();

      if (!updated) return sendError(reply, 404, 'NOT_FOUND', 'User not found');
      return reply.send({ success: true, data: serializeUser(updated) });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── POST /me/generate-keys ──────────────────────────────────────────────
  app.post('/me/generate-keys', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = GenerateKeysInputSchema.parse(request.body);
      const { generateKeyPair } = await import('@vault/crypto');
      const keyPair = await generateKeyPair(input.privateKeyPassword);

      const db = getDb();
      await db
        .update(users)
        .set({
          publicKey: keyPair.publicKey,
          encryptedPrivateKey: keyPair.encryptedPrivateKey,
          updatedAt: new Date(),
        })
        .where(eq(users.id, request.user.userId));

      return reply.send({ success: true, data: { publicKey: keyPair.publicKey } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      return sendError(
        reply,
        503,
        'CRYPTO_UNAVAILABLE',
        'Key generation is temporarily unavailable',
        { reason: error instanceof Error ? error.message : String(error) },
      );
    }
  });

  // ─── GET /me/key-material ────────────────────────────────────────────────
  app.get('/me/key-material', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const [user] = await db
      .select({ publicKey: users.publicKey, encryptedPrivateKey: users.encryptedPrivateKey })
      .from(users)
      .where(eq(users.id, request.user.userId))
      .limit(1);

    if (!user) return sendError(reply, 404, 'NOT_FOUND', 'User not found');
    if (!user.publicKey || !user.encryptedPrivateKey) {
      return sendError(reply, 404, 'KEYS_NOT_FOUND', 'Encryption keys have not been generated yet');
    }

    return reply.send({
      success: true,
      data: {
        publicKey: user.publicKey,
        encryptedPrivateKey: user.encryptedPrivateKey,
      },
    });
  });

  // ─── DELETE /me ──────────────────────────────────────────────────────────
  app.delete('/me', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { password } = z.object({ password: z.string().min(1) }).parse(request.body);

      const { default: bcrypt } = await import('bcryptjs');
      const db = getDb();

      const [user] = await db
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, request.user.userId))
        .limit(1);

      if (!user) return sendError(reply, 404, 'NOT_FOUND', 'User not found');

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid password');

      // Soft delete: anonymise PII, mark as deleted
      await db
        .update(users)
        .set({
          email: `deleted_${user.id}@vault.deleted`,
          displayName: null,
          phone: null,
          avatarUrl: null,
          publicKey: null,
          encryptedPrivateKey: null,
          expoPushToken: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      reply.clearCookie('vault_token', { path: '/' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── GET /:userId ────────────────────────────────────────────────────────
  app.get('/:userId', { preHandler: requireAuth }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) return sendError(reply, 404, 'NOT_FOUND', 'User not found');

    // Admin gets full profile, others get public profile
    if (request.user.role === 'admin' || request.user.userId === userId) {
      return reply.send({ success: true, data: serializeUser(user) });
    }

    return reply.send({ success: true, data: serializePublicUser(user) });
  });

  // ─── GET / (admin only, paginated) ──────────────────────────────────────
  app.get('/', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const query = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          role: z.string().optional(),
          kycStatus: z.string().optional(),
        })
        .parse(request.query);

      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      let baseQuery = db.select().from(users).$dynamic();

      if (query.role) {
        baseQuery = baseQuery.where(
          eq(users.role, query.role as typeof users.$inferSelect['role']),
        );
      }

      const rows = await baseQuery.limit(query.limit).offset(offset).orderBy(desc(users.createdAt));

      const [countRow] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(users);

      const total = countRow?.count ?? 0;

      return reply.send({
        success: true,
        data: {
          items: rows.map(serializeUser),
          total,
          page: query.page,
          limit: query.limit,
          totalPages: Math.ceil(total / query.limit),
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });
}
