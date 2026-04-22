import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import { aiService } from '@vault/ai';
import { createLogger } from '@vault/logger';
import { createHash } from 'crypto';
import { eq, and, gt } from 'drizzle-orm';

const logger = createLogger('ai-service:routes:translation');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { success: true as const, data };
}

function fail(code: string, message: string, status = 400) {
  return { success: false as const, error: { code, message }, _status: status };
}

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// ─── Supported Languages ──────────────────────────────────────────────────────

const SUPPORTED_LANGUAGES = [
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true },
  { code: 'fr', name: 'French', nativeName: 'Français', rtl: false },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '中文', rtl: false },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', rtl: false },
  { code: 'de', name: 'German', nativeName: 'Deutsch', rtl: false },
  { code: 'es', name: 'Spanish', nativeName: 'Español', rtl: false },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', rtl: false },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', rtl: false },
  { code: 'ko', name: 'Korean', nativeName: '한국어', rtl: false },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', rtl: false },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', rtl: false },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', rtl: false },
] as const;

const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

// ─── Schemas ──────────────────────────────────────────────────────────────────

const TranslateBody = z.object({
  text: z.string().min(1).max(10000),
  targetLanguage: z.string().min(2).max(10),
  sourceLanguage: z.string().min(2).max(10).optional().default('en'),
});

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export async function translationRoutes(app: FastifyInstance): Promise<void> {
  async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    try {
      await req.jwtVerify();
      const payload = req.user as { sub?: string; userId?: string; id?: string };
      return payload.sub ?? payload.userId ?? payload.id ?? null;
    } catch {
      reply.status(401).send(fail('UNAUTHORIZED', 'Invalid or missing token', 401));
      return null;
    }
  }

  // POST /translation/translate
  app.post('/translate', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const parsed = TranslateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(
        fail('VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', ')),
      );
    }

    const { text, targetLanguage, sourceLanguage } = parsed.data;
    const db = getDb();

    try {
      const { translationCache } = await import('@vault/db');

      const contentHash = hashContent(`${sourceLanguage}:${text}`);
      const now = new Date();

      // Check DB cache first
      const [cached] = await db
        .select()
        .from(translationCache)
        .where(
          and(
            eq(translationCache.contentHash, contentHash),
            eq(translationCache.targetLanguage, targetLanguage),
            gt(translationCache.expiresAt, now),
          ),
        )
        .limit(1);

      if (cached) {
        logger.debug({ contentHash, targetLanguage }, 'Translation cache hit');
        return reply.send(ok({
          originalText: text,
          translatedText: cached.translatedText,
          targetLanguage,
          sourceLanguage,
          fromCache: true,
        }));
      }

      // Call AI translation
      const result = await aiService.translate(text, targetLanguage);

      // Store in DB cache (TTL: 30 days)
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await db
        .insert(translationCache)
        .values({
          contentHash,
          targetLanguage,
          translatedText: result.translatedText,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [translationCache.contentHash, translationCache.targetLanguage],
          set: {
            translatedText: result.translatedText,
            expiresAt,
          },
        });

      logger.debug({ targetLanguage, textLength: text.length }, 'Translation completed');
      return reply.send(ok({
        originalText: text,
        translatedText: result.translatedText,
        targetLanguage,
        sourceLanguage,
        fromCache: false,
      }));
    } catch (err) {
      logger.error({ err, targetLanguage }, 'Translation failed');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Translation failed', 500));
    }
  });

  // GET /translation/languages
  app.get('/languages', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    return reply.send(ok({
      source: [{ code: 'en', name: 'English', nativeName: 'English', rtl: false }],
      target: SUPPORTED_LANGUAGES,
      pairs: SUPPORTED_CODES.map((code) => ({ from: 'en', to: code })),
    }));
  });
}
