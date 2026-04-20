import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { getDb } from '@vault/db';
import { amlScreenings, kycSubmissions, users } from '@vault/db/schema';
import { KycWizardSubmitInputSchema } from '@vault/types';
import { mockKYCSubmit } from '@vault/mocks';
import { requireAuth } from '../lib/auth.js';
import { handleZodError, sendError } from '../lib/errors.js';
import { approveKycSubmission } from '../lib/kyc.js';
import { serializeAMLScreening, serializeKycSubmission } from '../lib/serializers.js';

const IS_MOCK = process.env['MOCK_SERVICES'] !== 'false';

export async function kycRoutes(app: FastifyInstance) {
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
          submission: created ? serializeKycSubmission(created) : null,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

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

    if (
      IS_MOCK &&
      submission.status === 'submitted' &&
      Date.now() - submission.submittedAt.getTime() >= 2000
    ) {
      await approveKycSubmission(request.user.userId, 'Auto-approved in mock mode');

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
          submission: approved ? serializeKycSubmission(approved) : null,
          amlScreening: latestScreening ? serializeAMLScreening(latestScreening) : null,
        },
      });
    }

    return reply.send({
      success: true,
      data: {
        status: submission.status,
        submission: serializeKycSubmission(submission),
        amlScreening: screening ? serializeAMLScreening(screening) : null,
      },
    });
  });
}
