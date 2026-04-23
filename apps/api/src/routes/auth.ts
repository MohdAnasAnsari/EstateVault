import type { FastifyInstance, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { ZodError, z } from 'zod';
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
import {
  checkBruteForce,
  clearLoginAttempts,
  recordFailedAttempt,
} from '../lib/brute-force.js';
import {
  generateBackupCodes,
  generateTotpQrCode,
  generateTotpSecret,
  verifyTotpCode,
} from '../lib/totp.js';

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

function setAuthCookie(reply: FastifyReply, token: string): void {
  reply.setCookie('vault_token', token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
  });
}

export async function authRoutes(app: FastifyInstance) {
  // ─── Register ─────────────────────────────────────────────────────────────
  app.post('/register', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
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
          reraLicenseExpiry:
            input.role === 'agent'
              ? new Date(
                  (await mockValidateRERA(input.reraOrn ?? '')).expiryDate ?? Date.now(),
                )
              : null,
        })
        .returning();

      if (!user) {
        return sendError(reply, 500, 'USER_CREATE_FAILED', 'Failed to create user');
      }

      const verificationToken = (
        app.jwt.sign as (payload: object, options?: { expiresIn?: string }) => string
      )({ userId: user.id, purpose: 'verify-email' } as PurposeTokenPayload, {
        expiresIn: '24h',
      });

      await mockSendEmail(user.email, 'welcome', {
        displayName: user.displayName,
        verificationToken,
      });

      const token = signAccessToken(app, {
        userId: user.id,
        role: user.role,
        accessTier: user.accessTier,
      });

      setAuthCookie(reply, token);

      return reply.status(201).send({
        success: true,
        data: { token, user: serializeAuthUser(user) },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── Login ────────────────────────────────────────────────────────────────
  app.post('/login', {
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    try {
      const input = LoginInputSchema.parse(request.body);
      const identifier = input.email.toLowerCase();

      // Brute-force check
      const blocked = await checkBruteForce(request, reply, identifier);
      if (blocked) return;

      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.email, identifier)).limit(1);

      if (!user) {
        await recordFailedAttempt(identifier);
        return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      const validPassword = await bcrypt.compare(input.password, user.passwordHash);
      if (!validPassword) {
        const { locked, attemptsLeft } = await recordFailedAttempt(identifier);
        if (locked) {
          return sendError(reply, 429, 'ACCOUNT_LOCKED', 'Account locked for 1 hour due to failed attempts');
        }
        return sendError(
          reply,
          401,
          'INVALID_CREDENTIALS',
          `Invalid email or password. ${attemptsLeft} attempt(s) remaining.`,
        );
      }

      // ── 2FA check for Level 3 users ──────────────────────────────────────
      const totpSecret = (user as unknown as { totpSecret?: string | null }).totpSecret;
      if (user.accessTier === 'level_3' && totpSecret) {
        const body = request.body as Record<string, unknown>;
        const totpCode = body['totpCode'] as string | undefined;

        if (!totpCode) {
          return reply.status(200).send({
            success: true,
            data: { requiresTwoFactor: true },
          });
        }

        if (!verifyTotpCode(totpCode, totpSecret)) {
          await recordFailedAttempt(`2fa:${identifier}`);
          return sendError(reply, 401, 'INVALID_TOTP', 'Invalid two-factor authentication code');
        }

        await clearLoginAttempts(`2fa:${identifier}`);
      }

      await clearLoginAttempts(identifier);
      await db
        .update(users)
        .set({ lastActiveAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));

      const token = signAccessToken(app, {
        userId: user.id,
        role: user.role,
        accessTier: user.accessTier,
      });

      setAuthCookie(reply, token);

      return reply.send({
        success: true,
        data: { token, user: serializeAuthUser(user) },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── Logout ───────────────────────────────────────────────────────────────
  app.post('/logout', { preHandler: requireAuth }, async (_request, reply) => {
    reply.clearCookie('vault_token', { path: '/' });
    return reply.send({ success: true, data: { loggedOut: true } });
  });

  // ─── Refresh ──────────────────────────────────────────────────────────────
  app.post('/refresh', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
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

      const token = signAccessToken(app, {
        userId: user.id,
        role: user.role,
        accessTier: user.accessTier,
      });

      setAuthCookie(reply, token);

      return reply.send({
        success: true,
        data: { token, user: serializeAuthUser(user) },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── Verify email ─────────────────────────────────────────────────────────
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

  // ─── Send OTP ─────────────────────────────────────────────────────────────
  app.post('/send-otp', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    try {
      const input = SendOtpInputSchema.parse(request.body);
      const result = await mockSendOTP(input.phone);
      return reply.send({ success: true, data: { sent: result.success } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── Validate RERA ────────────────────────────────────────────────────────
  app.post('/validate-rera', {
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    try {
      const input = ValidateReraInputSchema.parse(request.body);
      const result = await mockValidateRERA(input.orn);
      return reply.send({ success: true, data: result });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── Verify phone ─────────────────────────────────────────────────────────
  app.post('/verify-phone', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
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

  // ─── Forgot password ──────────────────────────────────────────────────────
  app.post('/forgot-password', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    try {
      const input = ForgotPasswordInputSchema.parse(request.body);
      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

      if (user) {
        const token = (
          app.jwt.sign as (payload: object, options?: { expiresIn?: string }) => string
        )({ userId: user.id, purpose: 'reset-password' } as PurposeTokenPayload, {
          expiresIn: '1h',
        });
        await mockSendEmail(user.email, 'password_reset', {
          resetToken: token,
          resetLink: `${process.env['NEXTAUTH_URL'] ?? 'http://localhost:3000'}/auth/reset-password?token=${token}`,
        });
      }

      // Always return success to prevent email enumeration
      return reply.send({ success: true, data: { sent: true } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── Reset password ───────────────────────────────────────────────────────
  app.post('/reset-password', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
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

      // Clear any brute-force locks for this user's email
      const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, payload.userId)).limit(1);
      if (user) await clearLoginAttempts(user.email.toLowerCase());

      return reply.send({ success: true, data: { reset: true } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── 2FA: Setup TOTP ─────────────────────────────────────────────────────
  app.post('/2fa/setup', { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, request.user.userId)).limit(1);
    if (!user) return sendError(reply, 404, 'NOT_FOUND', 'User not found');

    const secret = generateTotpSecret();
    const qrCodeDataUrl = await generateTotpQrCode(user.email, secret);
    const backupCodes = generateBackupCodes();

    // Store secret temporarily (unconfirmed) — confirmed on verify
    await db
      .update(users)
      .set({
        // biome-ignore lint/suspicious/noExplicitAny: adding new field before migration
        ...(({ totpSecretPending: secret, totpBackupCodes: JSON.stringify(backupCodes) } as any)),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return reply.send({
      success: true,
      data: { secret, qrCode: qrCodeDataUrl, backupCodes },
    });
  });

  // ─── 2FA: Verify and enable TOTP ─────────────────────────────────────────
  app.post('/2fa/verify', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { code } = z.object({ code: z.string().length(6) }).parse(request.body);
      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.id, request.user.userId)).limit(1);
      if (!user) return sendError(reply, 404, 'NOT_FOUND', 'User not found');

      const pendingSecret = (user as unknown as { totpSecretPending?: string }).totpSecretPending;
      if (!pendingSecret) return sendError(reply, 400, 'NO_PENDING_TOTP', 'No pending 2FA setup');

      if (!verifyTotpCode(code, pendingSecret)) {
        return sendError(reply, 400, 'INVALID_TOTP', 'Invalid TOTP code');
      }

      await db
        .update(users)
        .set({
          // biome-ignore lint/suspicious/noExplicitAny: adding new field before migration
          ...(({ totpSecret: pendingSecret, totpSecretPending: null, totpEnabled: true } as any)),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return reply.send({ success: true, data: { enabled: true } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // ─── 2FA: Disable TOTP ───────────────────────────────────────────────────
  app.post('/2fa/disable', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { code, password } = z
        .object({ code: z.string().length(6), password: z.string().min(1) })
        .parse(request.body);

      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.id, request.user.userId)).limit(1);
      if (!user) return sendError(reply, 404, 'NOT_FOUND', 'User not found');

      const validPassword = await bcrypt.compare(password, user.passwordHash);
      if (!validPassword) return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid password');

      const totpSecret = (user as unknown as { totpSecret?: string }).totpSecret;
      if (!totpSecret) return sendError(reply, 400, 'TOTP_NOT_ENABLED', '2FA is not enabled');

      if (!verifyTotpCode(code, totpSecret)) {
        return sendError(reply, 400, 'INVALID_TOTP', 'Invalid TOTP code');
      }

      await db
        .update(users)
        .set({
          // biome-ignore lint/suspicious/noExplicitAny: adding new field before migration
          ...(({ totpSecret: null, totpEnabled: false, totpBackupCodes: null } as any)),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return reply.send({ success: true, data: { disabled: true } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });
}
