import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { getDb } from '@vault/db';
import { users } from '@vault/db/schema';
import {
  type AccessTier,
  ForgotPasswordInputSchema,
  LoginInputSchema,
  RefreshInputSchema,
  RegisterInputSchema,
  ResetPasswordInputSchema,
  SendOtpInputSchema,
  type UserRole,
  ValidateReraInputSchema,
  VerifyEmailInputSchema,
  VerifyPhoneInputSchema,
} from '@vault/types';
import { mockSendEmail, mockSendOTP, mockValidateRERA, mockVerifyOTP } from '@vault/mocks';
import { requireAuth } from '../lib/auth.js';
import { handleZodError, sendError } from '../lib/errors.js';
import { serializeAuthUser } from '../lib/serializers.js';

interface PurposeTokenPayload {
  userId: string;
  purpose: 'verify-email' | 'reset-password';
}

function signAccessToken(
  app: FastifyInstance,
  payload: { userId: string; role: UserRole; accessTier: AccessTier },
): string {
  return app.jwt.sign(payload, { expiresIn: '7d' });
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (request, reply) => {
    try {
      const input = RegisterInputSchema.parse(request.body);
      const db = getDb();

      const [existing] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
      if (existing) {
        return sendError(reply, 409, 'EMAIL_EXISTS', 'Email already registered');
      }

      if (input.role === 'agent') {
        const reraOrn = input.reraOrn ?? '';
        const reraResult = await mockValidateRERA(reraOrn);
        if (!reraResult.valid) {
          return sendError(reply, 400, 'INVALID_RERA', 'RERA ORN is invalid');
        }
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
          nationality: input.nationality,
          reraLicenseExpiry: input.role === 'agent' ? new Date((await mockValidateRERA(input.reraOrn ?? '')).expiryDate ?? Date.now()) : null,
        })
        .returning();

      if (!user) {
        return sendError(reply, 500, 'USER_CREATE_FAILED', 'Failed to create user');
      }

      const verificationToken = (app.jwt.sign as (payload: object, options?: { expiresIn?: string }) => string)(
        { userId: user.id, purpose: 'verify-email' } as PurposeTokenPayload,
        { expiresIn: '24h' },
      );

      await mockSendEmail(user.email, 'welcome', {
        displayName: user.displayName,
        verificationToken,
      });

      return reply.status(201).send({
        success: true,
        data: {
          token: signAccessToken(app, {
            userId: user.id,
            role: user.role,
            accessTier: user.accessTier,
          }),
          user: serializeAuthUser(user),
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.post('/login', async (request, reply) => {
    try {
      const input = LoginInputSchema.parse(request.body);
      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

      if (!user) {
        return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      const validPassword = await bcrypt.compare(input.password, user.passwordHash);
      if (!validPassword) {
        return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      await db
        .update(users)
        .set({ lastActiveAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));

      return reply.send({
        success: true,
        data: {
          token: signAccessToken(app, {
            userId: user.id,
            role: user.role,
            accessTier: user.accessTier,
          }),
          user: serializeAuthUser(user),
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.post('/logout', { preHandler: requireAuth }, async (_request, reply) => {
    return reply.send({ success: true, data: { loggedOut: true } });
  });

  app.post('/refresh', async (request, reply) => {
    try {
      const input = RefreshInputSchema.parse(request.body);
      let payload: { userId: string; role: UserRole; accessTier: AccessTier };

      try {
        payload = app.jwt.verify(input.token);
      } catch {
        return sendError(reply, 401, 'INVALID_TOKEN', 'Refresh token is invalid or expired');
      }

      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
      if (!user) {
        return sendError(reply, 404, 'NOT_FOUND', 'User not found');
      }

      return reply.send({
        success: true,
        data: {
          token: signAccessToken(app, {
            userId: user.id,
            role: user.role,
            accessTier: user.accessTier,
          }),
          user: serializeAuthUser(user),
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.post('/verify-email', async (request, reply) => {
    try {
      const input = VerifyEmailInputSchema.parse(request.body);
      let payload: PurposeTokenPayload;

      try {
        payload = app.jwt.verify(input.token) as unknown as PurposeTokenPayload;
      } catch {
        return sendError(reply, 400, 'INVALID_TOKEN', 'Verification token is invalid or expired');
      }

      if (payload.purpose !== 'verify-email') {
        return sendError(reply, 400, 'INVALID_TOKEN', 'Invalid verification token');
      }

      const db = getDb();
      await db
        .update(users)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(users.id, payload.userId));

      return reply.send({ success: true, data: { verified: true } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.post('/send-otp', async (request, reply) => {
    try {
      const input = SendOtpInputSchema.parse(request.body);
      const result = await mockSendOTP(input.phone);
      return reply.send({ success: true, data: { sent: result.success } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.post('/validate-rera', async (request, reply) => {
    try {
      const input = ValidateReraInputSchema.parse(request.body);
      const result = await mockValidateRERA(input.orn);
      return reply.send({ success: true, data: result });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.post('/verify-phone', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = VerifyPhoneInputSchema.parse(request.body);
      const result = await mockVerifyOTP(input.phone, input.code);

      if (!result.valid) {
        return sendError(reply, 400, 'INVALID_OTP', 'Invalid verification code');
      }

      const db = getDb();
      await db
        .update(users)
        .set({ phone: input.phone, phoneVerified: true, updatedAt: new Date() })
        .where(eq(users.id, request.user.userId));

      return reply.send({ success: true, data: { verified: true } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.post('/forgot-password', async (request, reply) => {
    try {
      const input = ForgotPasswordInputSchema.parse(request.body);
      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

      if (user) {
        const token = (app.jwt.sign as (payload: object, options?: { expiresIn?: string }) => string)(
          { userId: user.id, purpose: 'reset-password' } as PurposeTokenPayload,
          { expiresIn: '1h' },
        );
        await mockSendEmail(user.email, 'password_reset', {
          resetToken: token,
          resetLink: `${process.env['NEXTAUTH_URL'] ?? 'http://localhost:3000'}/auth/reset-password?token=${token}`,
        });
      }

      return reply.send({ success: true, data: { sent: true } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.post('/reset-password', async (request, reply) => {
    try {
      const input = ResetPasswordInputSchema.parse(request.body);
      let payload: PurposeTokenPayload;

      try {
        payload = app.jwt.verify(input.token) as unknown as PurposeTokenPayload;
      } catch {
        return sendError(reply, 400, 'INVALID_TOKEN', 'Reset token is invalid or expired');
      }

      if (payload.purpose !== 'reset-password') {
        return sendError(reply, 400, 'INVALID_TOKEN', 'Invalid reset token');
      }

      const passwordHash = await bcrypt.hash(input.password, 12);
      const db = getDb();
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, payload.userId));

      return reply.send({ success: true, data: { reset: true } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });
}
