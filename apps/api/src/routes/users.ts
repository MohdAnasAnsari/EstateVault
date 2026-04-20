import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@vault/db';
import { users, savedListings, listings, listingMedia } from '@vault/db/schema';
import { generateKeyPair, encryptPrivateKeyWithPassword } from '@vault/crypto';
import { requireAuth } from '../lib/auth.js';
import { sendError } from '../lib/errors.js';

export async function userRoutes(app: FastifyInstance) {
  // GET /users/me
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, request.user.userId))
      .limit(1);

    if (!user) return sendError(reply, 404, 'NOT_FOUND', 'User not found');

    // Never return sensitive fields
    const { passwordHash: _pw, realNameEncrypted: _rn, encryptedPrivateKey: _epk, ...safeUser } = user;

    return reply.send({ success: true, data: safeUser });
  });

  // PATCH /users/me
  app.patch('/me', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const body = request.body as {
      displayName?: string;
      preferredCurrency?: string;
      preferredLanguage?: string;
      expoPushToken?: string;
      avatarUrl?: string;
    };

    const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };

    if (body.displayName !== undefined) updates.displayName = body.displayName;
    if (body.preferredCurrency !== undefined) updates.preferredCurrency = body.preferredCurrency;
    if (body.preferredLanguage !== undefined) updates.preferredLanguage = body.preferredLanguage;
    if (body.expoPushToken !== undefined) updates.expoPushToken = body.expoPushToken;
    if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, request.user.userId))
      .returning();

    if (!updated) return sendError(reply, 404, 'NOT_FOUND', 'User not found');

    const { passwordHash: _pw, realNameEncrypted: _rn, encryptedPrivateKey: _epk, ...safeUser } = updated;
    return reply.send({ success: true, data: safeUser });
  });

  // GET /users/me/saved
  app.get('/me/saved', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const saved = await db
      .select()
      .from(savedListings)
      .where(eq(savedListings.userId, request.user.userId));

    const listingIds = saved.map((s) => s.listingId);
    if (listingIds.length === 0) {
      return reply.send({ success: true, data: [] });
    }

    const listingRows = await db
      .select()
      .from(listings)
      .where(eq(listings.sellerId, request.user.userId)); // re-query by owner for now

    return reply.send({ success: true, data: saved });
  });

  // GET /users/me/listings
  app.get('/me/listings', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(listings)
      .where(eq(listings.sellerId, request.user.userId));

    return reply.send({ success: true, data: rows });
  });

  // POST /users/me/generate-keys
  app.post('/me/generate-keys', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const { privateKeyPassword } = request.body as { privateKeyPassword: string };

    if (!privateKeyPassword) {
      return sendError(reply, 400, 'PASSWORD_REQUIRED', 'Private key password is required');
    }

    const keypair = await generateKeyPair();
    const { encryptedPrivateKey } = await encryptPrivateKeyWithPassword(
      keypair.privateKey,
      privateKeyPassword,
    );

    await db
      .update(users)
      .set({ publicKey: keypair.publicKey, encryptedPrivateKey, updatedAt: new Date() })
      .where(eq(users.id, request.user.userId));

    return reply.send({ success: true, data: { publicKey: keypair.publicKey } });
  });
}
