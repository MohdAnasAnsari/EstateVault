import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb } from '@vault/db';
import { users } from '@vault/db/schema';
import {
  RegisterInputSchema,
  LoginInputSchema,
} from '@vault/types';
import {
  mockSendEmail,
  mockValidateRERA,
  mockSendOTP,
  mockVerifyOTP,
} from '@vault/mocks';
import { sendError, handleZodError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';

const MOCK = process.env['MOCK_SERVICES'] !== 'false';

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/register
  app.post('/register', async (request, reply) => {
    try {
      const input = RegisterInputSchema.parse(request.body);

      // Validate RERA ORN for agents
      if (input.role === 'agent') {
        if (!input.reraOrn) {
          return sendError(reply, 400, 'RERA_REQUIRED', 'RERA ORN is required for agents');
        }
        const reraResult = MOCK
          ? await mockValidateRERA(input.reraOrn)
          : await mockValidateRERA(input.reraOrn); // swap for real when MOCK=false
        if (!reraResult.valid) {
          return sendError(reply, 400, 'INVALID_RERA', 'RERA ORN is invalid');
        }
      }

      const db = getDb();
      const existing = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
      if (existing.length > 0) {
        return sendError(reply, 409, 'EMAIL_EXISTS', 'Email already registered');
      }

      const passwordHash = await bcrypt.hash(input.password, 12);

      const [user] = await db
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          role: input.role,
          displayName: input.displayName,
          reraOrn: input.reraOrn,
          reraVerified: false,
          preferredCurrency: 'AED',
          preferredLanguage: 'en',
        })
        .returning();

      if (!user) return sendError(reply, 500, 'DB_ERROR', 'Failed to create user');

      const token = app.jwt.sign({
        userId: user.id,
        role: user.role,
        accessTier: user.accessTier,
      });

      // Send welcome email
      await mockSendEmail(user.email, 'welcome', { displayName: user.displayName });

      return reply.status(201).send({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            accessTier: user.accessTier,
            displayName: user.displayName,
            kycStatus: user.kycStatus,
          },
        },
      });
    } catch (err) {
      if (err instanceof ZodError) return handleZodError(reply, err);
      throw err;
    }
  });

  // POST /auth/login
  app.post('/login', async (request, reply) => {
    try {
      const input = LoginInputSchema.parse(request.body);
      const db = getDb();

      const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
      if (!user) {
        return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) {
        return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      // Update last active
      await db
        .update(users)
        .set({ lastActiveAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));

      const token = app.jwt.sign({
        userId: user.id,
        role: user.role,
        accessTier: user.accessTier,
      });

      return reply.send({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            accessTier: user.accessTier,
            displayName: user.displayName,
            kycStatus: user.kycStatus,
            avatarUrl: user.avatarUrl,
            preferredCurrency: user.preferredCurrency,
            preferredLanguage: user.preferredLanguage,
          },
        },
      });
    } catch (err) {
      if (err instanceof ZodError) return handleZodError(reply, err);
      throw err;
    }
  });

  // POST /auth/logout
  app.post('/logout', { preHandler: requireAuth }, async (_request, reply) => {
    return reply.send({ success: true, data: null });
  });

  // POST /auth/send-otp
  app.post('/send-otp', async (request, reply) => {
    try {
      const { phone } = request.body as { phone: string };
      if (!phone) return sendError(reply, 400, 'PHONE_REQUIRED', 'Phone is required');
      const result = await mockSendOTP(phone);
      return reply.send({ success: true, data: { sent: result.success } });
    } catch (err) {
      throw err;
    }
  });

  // POST /auth/verify-phone
  app.post('/verify-phone', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { phone, code } = request.body as { phone: string; code: string };
      const result = await mockVerifyOTP(phone, code);
      if (!result.valid) {
        return sendError(reply, 400, 'INVALID_OTP', 'Invalid verification code');
      }

      const db = getDb();
      await db
        .update(users)
        .set({ phone, phoneVerified: true, updatedAt: new Date() })
        .where(eq(users.id, request.user.userId));

      return reply.send({ success: true, data: { verified: true } });
    } catch (err) {
      throw err;
    }
  });

  // POST /auth/forgot-password
  app.post('/forgot-password', async (request, reply) => {
    try {
      const { email } = request.body as { email: string };
      if (!email) return sendError(reply, 400, 'EMAIL_REQUIRED', 'Email is required');

      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

      // Always respond success for security (don't reveal if email exists)
      if (user) {
        const resetToken = app.jwt.sign(
          { userId: user.id, purpose: 'reset' },
          { expiresIn: '1h' },
        );
        await mockSendEmail(email, 'password_reset', {
          resetLink: `${process.env['NEXTAUTH_URL']}/auth/reset-password?token=${resetToken}`,
        });
      }

      return reply.send({ success: true, data: { sent: true } });
    } catch (err) {
      throw err;
    }
  });

  // POST /auth/reset-password
  app.post('/reset-password', async (request, reply) => {
    try {
      const { token, password } = request.body as { token: string; password: string };
      if (!token || !password) {
        return sendError(reply, 400, 'MISSING_FIELDS', 'Token and password are required');
      }
      if (password.length < 8) {
        return sendError(reply, 400, 'PASSWORD_TOO_SHORT', 'Password must be at least 8 characters');
      }

      let payload: { userId: string; purpose: string };
      try {
        payload = app.jwt.verify(token) as typeof payload;
      } catch {
        return sendError(reply, 400, 'INVALID_TOKEN', 'Reset token is invalid or expired');
      }

      if (payload.purpose !== 'reset') {
        return sendError(reply, 400, 'INVALID_TOKEN', 'Invalid token purpose');
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const db = getDb();
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, payload.userId));

      return reply.send({ success: true, data: { reset: true } });
    } catch (err) {
      throw err;
    }
  });

  // POST /auth/verify-email
  app.post('/verify-email', async (request, reply) => {
    try {
      const { token } = request.body as { token: string };
      let payload: { userId: string; purpose: string };
      try {
        payload = app.jwt.verify(token) as typeof payload;
      } catch {
        return sendError(reply, 400, 'INVALID_TOKEN', 'Verification token is invalid or expired');
      }

      const db = getDb();
      await db
        .update(users)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(users.id, payload.userId));

      return reply.send({ success: true, data: { verified: true } });
    } catch (err) {
      throw err;
    }
  });
}
