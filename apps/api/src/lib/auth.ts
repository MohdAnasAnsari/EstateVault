import type { FastifyRequest, FastifyReply } from 'fastify';
import type { User } from '@vault/types';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; role: string; accessTier: string };
    user: { userId: string; role: string; accessTier: string };
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    await reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }
}

export async function requireLevel2(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  const tier = request.user.accessTier;
  if (tier === 'level_1') {
    await reply.status(403).send({
      success: false,
      error: { code: 'INSUFFICIENT_TIER', message: 'Level 2 access required' },
    });
  }
}

export function isSeller(role: string): boolean {
  return role === 'seller' || role === 'agent' || role === 'admin';
}
