import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AccessTier, UserRole } from '@vault/types';

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

export async function requireLevel2(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (request.user.accessTier === 'level_1') {
    await reply.status(403).send({
      success: false,
      error: { code: 'INSUFFICIENT_TIER', message: 'Level 2 access required' },
    });
  }
}

export async function requireLevel3(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (request.user.accessTier !== 'level_3' && request.user.role !== 'admin') {
    await reply.status(403).send({
      success: false,
      error: { code: 'INSUFFICIENT_TIER', message: 'Level 3 access required' },
    });
  }
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (request.user.role !== 'admin') {
    await reply.status(403).send({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Admin access required' },
    });
  }
}

export function isSeller(role: UserRole): boolean {
  return role === 'seller' || role === 'agent' || role === 'admin';
}
