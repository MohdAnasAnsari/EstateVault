import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import { aiService } from '@vault/ai';
import { createLogger } from '@vault/logger';
import { eq, desc } from 'drizzle-orm';

const logger = createLogger('ai-service:routes:concierge');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { success: true as const, data };
}

function fail(code: string, message: string, status = 400) {
  return { success: false as const, error: { code, message }, _status: status };
}

// ─── In-memory chat history (replace with DB-backed store for production) ─────

interface ChatMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

const chatHistory = new Map<string, ChatMessage[]>();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const ChatBody = z.object({
  message: z.string().min(1).max(2000),
  sessionId: z.string().uuid().optional(),
});

const SupportTicketBody = z.object({
  subject: z.string().min(1).max(255),
  body: z.string().min(1),
  email: z.string().email().optional(),
});

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export async function conciergeRoutes(app: FastifyInstance): Promise<void> {
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

  // POST /concierge/chat
  app.post('/chat', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(
        fail('VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', ')),
      );
    }

    const { message, sessionId } = parsed.data;
    const db = getDb();

    try {
      // Build context from user profile
      const { users, dealRooms, listings } = await import('@vault/db');
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

      // Get recent deal rooms
      const recentDeals = await db
        .select({
          id: dealRooms.id,
          status: dealRooms.status,
          listingTitle: listings.title,
        })
        .from(dealRooms)
        .innerJoin(listings, eq(dealRooms.listingId, listings.id))
        .where(eq(dealRooms.buyerId, userId))
        .orderBy(desc(dealRooms.updatedAt))
        .limit(3);

      // Retrieve chat history for this session
      const histKey = sessionId ?? userId;
      const history = chatHistory.get(histKey) ?? [];

      // Build context string
      const contextParts: string[] = [];
      if (user) {
        contextParts.push(`User role: ${user.role}, KYC: ${user.kycStatus}, tier: ${user.accessTier}`);
      }
      if (recentDeals.length > 0) {
        contextParts.push(
          `Recent deal rooms: ${recentDeals.map((d) => `${d.listingTitle} (${d.status})`).join(', ')}`,
        );
      }
      if (history.length > 0) {
        const recentHistory = history.slice(-6);
        contextParts.push(
          `Recent conversation:\n${recentHistory.map((m) => `${m.role}: ${m.content}`).join('\n')}`,
        );
      }

      const enrichedMessage = contextParts.length > 0
        ? `[Context: ${contextParts.join('. ')}]\n\nUser: ${message}`
        : message;

      const response = await aiService.conciergeLookup(enrichedMessage);

      // Store in history
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        userId,
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      };
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        userId,
        role: 'assistant',
        content: response.answer,
        createdAt: new Date().toISOString(),
      };
      history.push(userMsg, assistantMsg);
      chatHistory.set(histKey, history.slice(-50)); // Keep last 50 messages

      // If human handoff requested, create support ticket
      if (response.isHumanHandoff) {
        const { supportTickets } = await import('@vault/db');
        await db.insert(supportTickets).values({
          userId,
          email: user?.email,
          subject: 'Concierge human handoff request',
          body: `User message: ${message}\n\nConcierge response: ${response.answer}`,
        });
      }

      logger.debug({ userId, isHumanHandoff: response.isHumanHandoff }, 'Concierge chat processed');
      return reply.send(ok({
        sessionId: histKey,
        answer: response.answer,
        sources: response.sources,
        isHumanHandoff: response.isHumanHandoff,
        ticketId: response.ticketId,
        messageId: assistantMsg.id,
      }));
    } catch (err) {
      logger.error({ err, userId }, 'Concierge chat failed');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Chat processing failed', 500));
    }
  });

  // POST /concierge/support-ticket
  app.post('/support-ticket', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const parsed = SupportTicketBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(
        fail('VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', ')),
      );
    }

    const { subject, body, email } = parsed.data;
    const db = getDb();

    try {
      const { supportTickets, users } = await import('@vault/db');

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const resolvedEmail = email ?? user?.email;

      const [ticket] = await db
        .insert(supportTickets)
        .values({
          userId,
          email: resolvedEmail,
          subject,
          body,
        })
        .returning();

      logger.info({ userId, ticketId: ticket?.id }, 'Support ticket created');
      return reply.status(201).send(ok({ ticketId: ticket?.id, subject, status: 'open' }));
    } catch (err) {
      logger.error({ err, userId }, 'Failed to create support ticket');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to create support ticket', 500));
    }
  });

  // GET /concierge/history
  app.get('/history', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    try {
      const history = chatHistory.get(userId) ?? [];
      return reply.send(ok({ history, total: history.length }));
    } catch (err) {
      logger.error({ err, userId }, 'Failed to get chat history');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to get chat history', 500));
    }
  });
}
