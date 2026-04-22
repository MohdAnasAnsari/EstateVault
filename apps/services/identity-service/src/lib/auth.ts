import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AccessTier, UserRole } from '@vault/types';
import { getRedis } from '@vault/cache';

// ─── JWT payload type ─────────────────────────────────────────────────────────

export interface JwtUser {
  userId: string;
  role: UserRole;
  accessTier: AccessTier;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

// ─── Auth guards ──────────────────────────────────────────────────────────────

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify<JwtUser>();
  } catch {
    await reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (request.user.role !== 'admin') {
    await reply.status(403).send({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Admin access required' },
    });
  }
}

export async function requireLevel3(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (request.user.accessTier !== 'level_3' && request.user.role !== 'admin') {
    await reply.status(403).send({
      success: false,
      error: { code: 'INSUFFICIENT_TIER', message: 'Level 3 access required' },
    });
  }
}

// ─── Brute force helpers ──────────────────────────────────────────────────────

const MAX_ATTEMPTS = Number(process.env['BRUTE_FORCE_MAX_ATTEMPTS'] ?? 10);
const LOCKOUT_SECONDS = Number(process.env['BRUTE_FORCE_LOCKOUT_SECONDS'] ?? 3600);

function loginKey(identifier: string): string {
  return `bf:login:${identifier}`;
}

function lockKey(identifier: string): string {
  return `bf:lock:${identifier}`;
}

export async function recordFailedAttempt(
  identifier: string,
): Promise<{ locked: boolean; attemptsLeft: number }> {
  const redis = getRedis() as unknown as {
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    set(key: string, value: string, mode: string, ttl: number): Promise<unknown>;
    del(key: string): Promise<unknown>;
  };

  const attempts = await redis.incr(loginKey(identifier));
  if (attempts === 1) {
    await redis.expire(loginKey(identifier), LOCKOUT_SECONDS);
  }

  if (attempts >= MAX_ATTEMPTS) {
    await redis.set(lockKey(identifier), '1', 'EX', LOCKOUT_SECONDS);
    await redis.del(loginKey(identifier));
    return { locked: true, attemptsLeft: 0 };
  }

  return { locked: false, attemptsLeft: MAX_ATTEMPTS - attempts };
}

export async function clearFailedAttempts(identifier: string): Promise<void> {
  const redis = getRedis() as unknown as {
    del(key: string): Promise<unknown>;
  };
  await redis.del(loginKey(identifier));
  await redis.del(lockKey(identifier));
}

async function isLockedOut(identifier: string): Promise<{ locked: boolean; ttl: number }> {
  const redis = getRedis() as unknown as {
    exists(key: string): Promise<number>;
    ttl(key: string): Promise<number>;
  };
  const locked = await redis.exists(lockKey(identifier));
  if (!locked) return { locked: false, ttl: 0 };
  const ttl = await redis.ttl(lockKey(identifier));
  return { locked: true, ttl };
}

export async function checkBruteForce(
  request: FastifyRequest,
  reply: FastifyReply,
  identifier: string,
): Promise<boolean> {
  const { locked, ttl } = await isLockedOut(identifier);
  if (locked) {
    const minutesLeft = Math.ceil(ttl / 60);
    await reply.status(429).send({
      success: false,
      error: {
        code: 'ACCOUNT_LOCKED',
        message: `Account locked due to too many failed attempts. Try again in ${minutesLeft} minute(s).`,
        retryAfterSeconds: ttl,
      },
    });
    return true;
  }
  return false;
}
