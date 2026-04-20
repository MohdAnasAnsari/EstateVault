import type { FastifyInstance } from 'fastify';
import { eq, inArray, or } from 'drizzle-orm';
import { ZodError } from 'zod';
import { getDb } from '@vault/db';
import { kycSubmissions, listingMedia, listings, savedListings, users } from '@vault/db/schema';
import {
  GenerateKeysInputSchema,
  KycUploadInputSchema,
  UpdateProfileInputSchema,
} from '@vault/types';
import { mockKYCSubmit } from '@vault/mocks';
import { requireAuth } from '../lib/auth.js';
import { handleZodError, sendError } from '../lib/errors.js';
import { serializeKycSubmission } from '../lib/serializers.js';
import {
  serializeListingWithMedia,
  serializeSavedListingWithListing,
  serializeUser,
} from '../lib/serializers.js';

export async function userRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, request.user.userId)).limit(1);

    if (!user) return sendError(reply, 404, 'NOT_FOUND', 'User not found');
    return reply.send({ success: true, data: serializeUser(user) });
  });

  app.get('/me/key-material', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, request.user.userId)).limit(1);

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

  app.patch('/me', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = UpdateProfileInputSchema.parse(request.body);
      const db = getDb();
      const [updated] = await db
        .update(users)
        .set({
          displayName: input.displayName,
          preferredCurrency: input.preferredCurrency,
          preferredLanguage: input.preferredLanguage,
          expoPushToken: input.expoPushToken,
          avatarUrl: input.avatarUrl,
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

  app.get('/me/saved', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const savedRows = await db
      .select()
      .from(savedListings)
      .where(eq(savedListings.userId, request.user.userId));

    if (savedRows.length === 0) {
      return reply.send({ success: true, data: [] });
    }

    const listingIds = savedRows.map((row) => row.listingId);
    const listingRows = await db.select().from(listings).where(inArray(listings.id, listingIds));
    const mediaRows = await db.select().from(listingMedia).where(inArray(listingMedia.listingId, listingIds));

    const mediaByListing = new Map<string, typeof mediaRows>();
    for (const media of mediaRows) {
      const bucket = mediaByListing.get(media.listingId) ?? [];
      bucket.push(media);
      mediaByListing.set(media.listingId, bucket);
    }

    const listingMap = new Map(
      listingRows.map((row) => [row.id, serializeListingWithMedia(row, mediaByListing.get(row.id) ?? [])]),
    );

    return reply.send({
      success: true,
      data: savedRows
        .map((row) => {
          const listing = listingMap.get(row.listingId);
          return listing ? serializeSavedListingWithListing(row, listing) : null;
        })
        .filter((row): row is NonNullable<typeof row> => row !== null),
    });
  });

  app.get('/me/listings', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const rows =
      request.user.role === 'admin'
        ? await db.select().from(listings)
        : await db
            .select()
            .from(listings)
            .where(
              request.user.role === 'agent'
                ? or(eq(listings.agentId, request.user.userId), eq(listings.sellerId, request.user.userId))
                : eq(listings.sellerId, request.user.userId),
            );

    const listingIds = rows.map((row) => row.id);
    const mediaRows =
      listingIds.length > 0
        ? await db.select().from(listingMedia).where(inArray(listingMedia.listingId, listingIds))
        : [];

    const mediaByListing = new Map<string, typeof mediaRows>();
    for (const media of mediaRows) {
      const bucket = mediaByListing.get(media.listingId) ?? [];
      bucket.push(media);
      mediaByListing.set(media.listingId, bucket);
    }

    return reply.send({
      success: true,
      data: rows.map((row) => serializeListingWithMedia(row, mediaByListing.get(row.id) ?? [])),
    });
  });

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
      return sendError(reply, 503, 'CRYPTO_UNAVAILABLE', 'Key generation is temporarily unavailable', {
        reason: error instanceof Error ? error.message : error,
      });
    }
  });

  app.post('/me/kyc', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = KycUploadInputSchema.parse(request.body);
      const submission = await mockKYCSubmit(request.user.userId, input.documents);
      const db = getDb();

      const [created] = await db
        .insert(kycSubmissions)
        .values({
          userId: request.user.userId,
          status: 'submitted',
          jumioReference: submission.referenceId,
          documentS3Keys: {
            documents: input.documents,
          },
        })
        .returning();

      await db
        .update(users)
        .set({ kycStatus: 'submitted', updatedAt: new Date() })
        .where(eq(users.id, request.user.userId));

      return reply.send({
        success: true,
        data: {
          ...submission,
          submission: created ? serializeKycSubmission(created) : null,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });
}
