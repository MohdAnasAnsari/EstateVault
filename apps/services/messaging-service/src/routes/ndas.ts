import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getDb } from '@vault/db';
import { ndas, dealRoomParticipants, dealRooms } from '@vault/db';
import { eq, and } from 'drizzle-orm';
import { getRedis } from '@vault/cache';
import { generateNdaPdf, type NdaParty } from '../lib/deal-rooms.js';

const CHANNEL_PREFIX = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';

// ─── Static NDA templates ─────────────────────────────────────────────────────

const NDA_TEMPLATES = [
  {
    id: 'tpl-v1',
    version: 'v1.0',
    name: 'Standard EstateVault NDA',
    description: 'Standard non-disclosure agreement for real estate deal rooms. Governed by UAE law.',
    jurisdiction: 'UAE',
    termYears: 3,
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'tpl-v2',
    version: 'v2.0',
    name: 'Enhanced Confidentiality NDA',
    description:
      'Enhanced NDA with additional IP protection clauses, suitable for luxury and heritage estates.',
    jurisdiction: 'UAE',
    termYears: 5,
    createdAt: '2024-06-01T00:00:00Z',
  },
] as const;

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

const createTemplateSchema = z.object({
  version: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  jurisdiction: z.string().default('UAE'),
  termYears: z.number().int().positive().default(3),
});

const signNdaSchema = z.object({
  signature: z.string().min(1, 'Signature is required'),
  signerName: z.string().min(1, 'Signer name is required'),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function ndaRoutes(app: FastifyInstance) {
  // GET /templates — list NDA templates
  app.get('/templates', async (_request: FastifyRequest, reply: FastifyReply) => {
    return ok(reply, { items: NDA_TEMPLATES });
  });

  // GET /templates/:id — get NDA template
  app.get(
    '/templates/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const template = NDA_TEMPLATES.find((t) => t.id === request.params.id);
      if (!template) {
        return errRes(reply, 'NOT_FOUND', 'NDA template not found', 404);
      }
      return ok(reply, { template });
    },
  );

  // POST /templates — create NDA template (admin only)
  app.post('/templates', async (request: FastifyRequest, reply: FastifyReply) => {
    const userRole = request.headers['x-user-role'] as string | undefined;
    if (userRole !== 'admin') {
      return errRes(reply, 'FORBIDDEN', 'Only admins can create NDA templates', 403);
    }

    const parsed = createTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return errRes(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
    }

    // In a real system this would persist to DB; for now return constructed object
    const template = {
      id: `tpl-${Date.now()}`,
      ...parsed.data,
      createdAt: new Date().toISOString(),
    };

    return ok(reply, { template }, 201);
  });

  // GET /deal-rooms/:roomId/nda — get NDA status
  app.get(
    '/deal-rooms/:roomId/nda',
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

      const [nda] = await db
        .select()
        .from(ndas)
        .where(eq(ndas.dealRoomId, roomId))
        .limit(1);

      if (!nda) {
        return ok(reply, {
          status: 'not_created',
          roomId,
          message: 'No NDA has been created for this deal room yet.',
        });
      }

      const myParty = nda.parties.find((p) => p.participantId === participant.id);

      return ok(reply, {
        id: nda.id,
        dealRoomId: nda.dealRoomId,
        templateVersion: nda.templateVersion,
        status: nda.status,
        parties: nda.parties,
        mySigned: myParty?.signedAt !== null,
        pdfAvailable: !!nda.pdfS3Key,
        createdAt: nda.createdAt,
        updatedAt: nda.updatedAt,
      });
    },
  );

  // POST /deal-rooms/:roomId/nda/sign — sign NDA
  app.post(
    '/deal-rooms/:roomId/nda/sign',
    async (
      request: FastifyRequest<{ Params: { roomId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId } = request.params;

      const parsed = signNdaSchema.safeParse(request.body);
      if (!parsed.success) {
        return errRes(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const { signature, signerName } = parsed.data;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db);
      if (!participant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      // Compute signature hash
      const signatureHash = createHash('sha256')
        .update(`${userId}:${roomId}:${signature}:${Date.now()}`)
        .digest('hex');

      // Get or create NDA record
      let [nda] = await db
        .select()
        .from(ndas)
        .where(eq(ndas.dealRoomId, roomId))
        .limit(1);

      const signedAt = new Date().toISOString();

      if (!nda) {
        // Get all current participants to seed parties
        const participants = await db
          .select()
          .from(dealRoomParticipants)
          .where(eq(dealRoomParticipants.dealRoomId, roomId));

        const parties: NdaParty[] = participants.map((p) => ({
          participantId: p.id,
          pseudonym: p.pseudonym,
          role: p.role,
          signedAt: p.userId === userId ? signedAt : null,
          signatureHash: p.userId === userId ? signatureHash : null,
        }));

        const [created] = await db
          .insert(ndas)
          .values({
            dealRoomId: roomId,
            templateVersion: 'v1.0',
            parties,
            signatureHashes: { [participant.id]: signatureHash },
            status: 'partially_signed',
          })
          .returning();

        nda = created!;
      } else {
        // Update existing NDA — add this participant's signature
        const updatedParties = nda.parties.map((p) =>
          p.participantId === participant.id
            ? { ...p, signedAt, signatureHash }
            : p,
        );

        const updatedHashes = {
          ...nda.signatureHashes,
          [participant.id]: signatureHash,
        };

        // Check if all parties have signed
        const allSigned = updatedParties.every((p) => p.signedAt !== null);
        const newStatus: 'partially_signed' | 'signed' = allSigned ? 'signed' : 'partially_signed';

        const [updated] = await db
          .update(ndas)
          .set({
            parties: updatedParties,
            signatureHashes: updatedHashes,
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(ndas.id, nda.id))
          .returning();

        nda = updated!;
      }

      // Generate PDF if all parties have signed
      let pdfS3Key: string | undefined;
      if (nda.status === 'signed') {
        const timestamp = new Date();
        const pdfBytes = await generateNdaPdf(
          {
            id: nda.id,
            dealRoomId: nda.dealRoomId,
            templateVersion: nda.templateVersion,
            parties: nda.parties,
            status: nda.status,
          },
          signerName,
          timestamp,
        );

        // In production: upload to S3; store key
        pdfS3Key = `ndas/${nda.id}/signed-nda.pdf`;

        await db
          .update(ndas)
          .set({ pdfS3Key, updatedAt: new Date() })
          .where(eq(ndas.id, nda.id));

        // Update deal room NDA status
        await db
          .update(dealRooms)
          .set({ ndaStatus: 'signed', updatedAt: new Date() })
          .where(eq(dealRooms.id, roomId));

        // Publish NDA signed event
        const redis = getRedis();
        await redis.set(
          `${CHANNEL_PREFIX}nda.signed`,
          JSON.stringify({
            roomId,
            ndaId: nda.id,
            signedAt: new Date().toISOString(),
          }),
        );

        // Suppress linting for pdfBytes — in production this uploads to S3
        void pdfBytes;
      }

      return ok(reply, {
        ndaId: nda.id,
        status: nda.status,
        signedAt,
        signatureHash,
        pdfAvailable: !!pdfS3Key || !!nda.pdfS3Key,
      });
    },
  );

  // GET /deal-rooms/:roomId/nda/pdf — download signed NDA PDF
  app.get(
    '/deal-rooms/:roomId/nda/pdf',
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

      const [nda] = await db
        .select()
        .from(ndas)
        .where(eq(ndas.dealRoomId, roomId))
        .limit(1);

      if (!nda) {
        return errRes(reply, 'NOT_FOUND', 'No NDA found for this deal room', 404);
      }

      if (nda.status !== 'signed') {
        return errRes(reply, 'NOT_READY', 'NDA has not been fully signed yet', 422);
      }

      if (!nda.pdfS3Key) {
        // Re-generate PDF on the fly
        const timestamp = new Date(nda.updatedAt);
        const pdfBytes = await generateNdaPdf(
          {
            id: nda.id,
            dealRoomId: nda.dealRoomId,
            templateVersion: nda.templateVersion,
            parties: nda.parties,
            status: nda.status,
          },
          'Participant',
          timestamp,
        );

        reply.header('Content-Type', 'application/pdf');
        reply.header(
          'Content-Disposition',
          `attachment; filename="nda-${nda.id}.pdf"`,
        );
        return reply.send(Buffer.from(pdfBytes));
      }

      // In production: generate signed S3 pre-signed URL or stream from S3
      return ok(reply, {
        message: 'NDA PDF available',
        s3Key: nda.pdfS3Key,
        note: 'In production, a pre-signed S3 URL is returned here.',
      });
    },
  );
}
