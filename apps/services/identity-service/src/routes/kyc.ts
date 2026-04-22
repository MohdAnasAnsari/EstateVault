import type { FastifyInstance, FastifyReply } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { ZodError, z } from 'zod';
import { getDb } from '@vault/db';
import { amlScreenings, kycSubmissions, users } from '@vault/db/schema';
import { KycWizardSubmitInputSchema } from '@vault/types';
import { mockAMLScreening, mockKYCSubmit } from '@vault/mocks';
import { getRedis } from '@vault/cache';
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

type DbKycSubmission = typeof kycSubmissions.$inferSelect;
type DbAMLScreening = typeof amlScreenings.$inferSelect;

function serializeKyc(row: DbKycSubmission) {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    jumioReference: row.jumioReference ?? null,
    documentS3Keys: row.documentS3Keys ?? {},
    financialCapacityRange: row.financialCapacityRange ?? null,
    assetTypeInterests: row.assetTypeInterests ?? [],
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    issueDate: row.issueDate?.toISOString() ?? null,
    reviewReason: row.reviewReason ?? null,
  };
}

function serializeAML(row: DbAMLScreening) {
  return {
    id: row.id,
    userId: row.userId,
    riskScore: row.riskScore,
    pepMatch: row.pepMatch,
    sanctionsMatch: row.sanctionsMatch,
    requiresReview: row.requiresReview,
    screenedAt: row.screenedAt.toISOString(),
    reviewerNotes: row.reviewerNotes ?? null,
  };
}

async function publishEvent(channel: string, payload: string): Promise<void> {
  try {
    const redis = getRedis() as unknown as {
      publish(channel: string, message: string): Promise<number>;
    };
    const prefix = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';
    await redis.publish(`${prefix}${channel}`, payload);
  } catch (err) {
    console.error('[identity-service] Failed to publish Redis event:', err);
  }
}

async function approveKycInternal(userId: string, reason?: string | null): Promise<void> {
  const db = getDb();

  const [submission] = await db
    .select()
    .from(kycSubmissions)
    .where(eq(kycSubmissions.userId, userId))
    .orderBy(desc(kycSubmissions.submittedAt))
    .limit(1);

  if (!submission) return;

  const reviewedAt = new Date();
  await db
    .update(kycSubmissions)
    .set({ status: 'approved', reviewedAt, reviewReason: reason ?? null })
    .where(eq(kycSubmissions.id, submission.id));

  await db
    .update(users)
    .set({ kycStatus: 'approved', accessTier: 'level_3', updatedAt: reviewedAt })
    .where(eq(users.id, userId));
}

async function rejectKycInternal(userId: string, reason?: string | null): Promise<void> {
  const db = getDb();

  const [submission] = await db
    .select()
    .from(kycSubmissions)
    .where(eq(kycSubmissions.userId, userId))
    .orderBy(desc(kycSubmissions.submittedAt))
    .limit(1);

  if (!submission) return;

  const reviewedAt = new Date();
  await db
    .update(kycSubmissions)
    .set({ status: 'rejected', reviewedAt, reviewReason: reason ?? null })
    .where(eq(kycSubmissions.id, submission.id));

  await db
    .update(users)
    .set({ kycStatus: 'rejected', updatedAt: reviewedAt })
    .where(eq(users.id, userId));
}

const IS_MOCK = process.env['MOCK_SERVICES'] !== 'false';

// ─── KYC routes ───────────────────────────────────────────────────────────────

export async function kycRoutes(app: FastifyInstance) {
  // ─── POST /submit ─────────────────────────────────────────────────────────
  app.post('/submit', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = KycWizardSubmitInputSchema.parse(request.body);
      const submission = await mockKYCSubmit(request.user.userId, input);
      const db = getDb();

      const [created] = await db
        .insert(kycSubmissions)
        .values({
          userId: request.user.userId,
          status: 'submitted',
          jumioReference: submission.referenceId,
          documentS3Keys: {
            documentType: input.documentType,
            front: input.documents.front,
            back: input.documents.back ?? null,
            selfie: input.documents.selfie,
            proofOfAddress: input.documents.proofOfAddress,
            livenessPrompt: input.livenessPrompt,
          },
          financialCapacityRange: input.financialCapacityRange,
          assetTypeInterests: input.assetTypeInterests,
          issueDate: new Date(input.issueDate),
        })
        .returning();

      await db
        .update(users)
        .set({ kycStatus: 'submitted', updatedAt: new Date() })
        .where(eq(users.id, request.user.userId));

      return reply.send({
        success: true,
        data: {
          status: submission.status,
          submission: created ? serializeKyc(created) : null,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── GET /status ──────────────────────────────────────────────────────────
  app.get('/status', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();

    const [submission] = await db
      .select()
      .from(kycSubmissions)
      .where(eq(kycSubmissions.userId, request.user.userId))
      .orderBy(desc(kycSubmissions.submittedAt))
      .limit(1);

    const [screening] = await db
      .select()
      .from(amlScreenings)
      .where(eq(amlScreenings.userId, request.user.userId))
      .orderBy(desc(amlScreenings.screenedAt))
      .limit(1);

    if (!submission) {
      return sendError(reply, 404, 'NOT_FOUND', 'No KYC submission found');
    }

    // Auto-approve in mock mode after 2s
    if (
      IS_MOCK &&
      submission.status === 'submitted' &&
      Date.now() - submission.submittedAt.getTime() >= 2000
    ) {
      await approveKycInternal(request.user.userId, 'Auto-approved in mock mode');
      await publishEvent('user.kyc.approved', request.user.userId);

      const [approved] = await db
        .select()
        .from(kycSubmissions)
        .where(eq(kycSubmissions.id, submission.id))
        .limit(1);

      const [latestScreening] = await db
        .select()
        .from(amlScreenings)
        .where(eq(amlScreenings.userId, request.user.userId))
        .orderBy(desc(amlScreenings.screenedAt))
        .limit(1);

      return reply.send({
        success: true,
        data: {
          status: approved?.status ?? 'approved',
          submission: approved ? serializeKyc(approved) : null,
          amlScreening: latestScreening ? serializeAML(latestScreening) : null,
        },
      });
    }

    return reply.send({
      success: true,
      data: {
        status: submission.status,
        submission: serializeKyc(submission),
        amlScreening: screening ? serializeAML(screening) : null,
      },
    });
  });

  // ─── GET / (admin: list pending) ─────────────────────────────────────────
  app.get('/', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const query = z
        .object({
          status: z.enum(['pending', 'submitted', 'approved', 'rejected']).optional(),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
        })
        .parse(request.query);

      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      let baseQuery = db.select().from(kycSubmissions).$dynamic();

      if (query.status) {
        baseQuery = baseQuery.where(eq(kycSubmissions.status, query.status));
      }

      const rows = await baseQuery
        .limit(query.limit)
        .offset(offset)
        .orderBy(desc(kycSubmissions.submittedAt));

      return reply.send({
        success: true,
        data: {
          items: rows.map(serializeKyc),
          page: query.page,
          limit: query.limit,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── PATCH /:submissionId/approve (admin) ─────────────────────────────────
  app.patch('/:submissionId/approve', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { submissionId } = z
        .object({ submissionId: z.string().uuid() })
        .parse(request.params);
      const { reason } = z
        .object({ reason: z.string().max(500).optional() })
        .parse(request.body);

      const db = getDb();
      const [submission] = await db
        .select()
        .from(kycSubmissions)
        .where(eq(kycSubmissions.id, submissionId))
        .limit(1);

      if (!submission) return sendError(reply, 404, 'NOT_FOUND', 'Submission not found');

      await approveKycInternal(submission.userId, reason ?? null);
      await publishEvent('user.kyc.approved', submission.userId);

      const [updated] = await db
        .select()
        .from(kycSubmissions)
        .where(eq(kycSubmissions.id, submissionId))
        .limit(1);

      return reply.send({
        success: true,
        data: { submission: updated ? serializeKyc(updated) : null },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── PATCH /:submissionId/reject (admin) ──────────────────────────────────
  app.patch('/:submissionId/reject', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { submissionId } = z
        .object({ submissionId: z.string().uuid() })
        .parse(request.params);
      const { reason } = z
        .object({ reason: z.string().max(500).optional() })
        .parse(request.body);

      const db = getDb();
      const [submission] = await db
        .select()
        .from(kycSubmissions)
        .where(eq(kycSubmissions.id, submissionId))
        .limit(1);

      if (!submission) return sendError(reply, 404, 'NOT_FOUND', 'Submission not found');

      await rejectKycInternal(submission.userId, reason ?? null);

      const [updated] = await db
        .select()
        .from(kycSubmissions)
        .where(eq(kycSubmissions.id, submissionId))
        .limit(1);

      return reply.send({
        success: true,
        data: { submission: updated ? serializeKyc(updated) : null },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── POST /aml-screen ─────────────────────────────────────────────────────
  app.post('/aml-screen', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { userId, realName, nationality } = z
        .object({
          userId: z.string().uuid(),
          realName: z.string().min(2).max(200),
          nationality: z.string().min(2).max(100),
        })
        .parse(request.body);

      const db = getDb();

      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!existingUser) return sendError(reply, 404, 'NOT_FOUND', 'User not found');

      const amlResult = await mockAMLScreening(realName, nationality);

      const [screening] = await db
        .insert(amlScreenings)
        .values({
          userId,
          riskScore: amlResult.riskScore,
          pepMatch: amlResult.pepMatch,
          sanctionsMatch: amlResult.sanctionsMatch,
          requiresReview: amlResult.requiresReview,
          reviewerNotes: amlResult.reviewerNotes ?? null,
        })
        .returning();

      return reply.send({
        success: true,
        data: { screening: screening ? serializeAML(screening) : null },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });
}
