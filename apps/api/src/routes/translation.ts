import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { ZodError } from 'zod';
import { getDb } from '@vault/db';
import { translationCache } from '@vault/db/schema';
import { TranslationInputSchema } from '@vault/types';
import { aiService } from '@vault/ai';
import { handleZodError, sendError } from '../lib/errors.js';

export async function translationRoutes(app: FastifyInstance) {
  // POST / - translate text (no auth required)
  app.post('/', async (request, reply) => {
    try {
      const input = TranslationInputSchema.parse(request.body);
      const { text, targetLanguage } = input;

      const hash = createHash('sha256').update(text).digest('hex');
      const db = getDb();
      const now = new Date();

      // Check cache
      const [cached] = await db
        .select()
        .from(translationCache)
        .where(
          and(
            eq(translationCache.contentHash, hash),
            eq(translationCache.targetLanguage, targetLanguage),
            gt(translationCache.expiresAt, now),
          ),
        )
        .limit(1);

      if (cached) {
        return reply.send({
          success: true,
          data: {
            originalText: text,
            translatedText: cached.translatedText,
            targetLanguage,
            fromCache: true,
          },
        });
      }

      // Call AI service
      const result = await aiService.translate(text, targetLanguage);

      // Insert into cache with 7-day expiry
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      try {
        await db.insert(translationCache).values({
          contentHash: hash,
          targetLanguage,
          translatedText: result.translatedText,
          expiresAt,
        });
      } catch {
        // Ignore duplicate key errors (race condition)
      }

      return reply.send({
        success: true,
        data: { ...result, fromCache: false },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to translate text');
    }
  });
}
