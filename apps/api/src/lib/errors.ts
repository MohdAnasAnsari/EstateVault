import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return reply.status(status).send({
    success: false,
    error: { code, message, details },
  });
}

export function handleZodError(reply: FastifyReply, err: ZodError) {
  return sendError(reply, 400, 'VALIDATION_ERROR', 'Invalid input', err.flatten());
}
