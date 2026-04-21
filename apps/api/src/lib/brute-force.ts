import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRedis } from '@vault/cache';

const MAX_ATTEMPTS = Number(process.env['BRUTE_FORCE_MAX_ATTEMPTS'] ?? 10);
const LOCKOUT_SECONDS = Number(process.env['BRUTE_FORCE_LOCKOUT_SECONDS'] ?? 3600);

function loginKey(identifier: string): string {
  return `bf:login:${identifier}`;
}

function lockKey(identifier: string): string {
  return `bf:lock:${identifier}`;
}

export async function recordFailedAttempt(identifier: string): Promise<{ locked: boolean; attemptsLeft: number }> {
  const redis = getRedis();
  const key = loginKey(identifier);

  const attempts = await redis.incr(key);
  if (attempts === 1) {
    await redis.expire(key, LOCKOUT_SECONDS);
  }

  if (attempts >= MAX_ATTEMPTS) {
    await redis.set(lockKey(identifier), '1', 'EX', LOCKOUT_SECONDS);
    await redis.del(key);
    return { locked: true, attemptsLeft: 0 };
  }

  return { locked: false, attemptsLeft: MAX_ATTEMPTS - attempts };
}

export async function clearLoginAttempts(identifier: string): Promise<void> {
  const redis = getRedis();
  await redis.del(loginKey(identifier));
  await redis.del(lockKey(identifier));
}

export async function isLockedOut(identifier: string): Promise<{ locked: boolean; ttl: number }> {
  const redis = getRedis();
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
