import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { getDb } from '@vault/db';
import { dealTeamMembers, users } from '@vault/db/schema';
import { InviteDealTeamMemberInputSchema, UpdateDealTeamMemberInputSchema } from '@vault/types';
import { requireAuth } from '../lib/auth.js';
import { handleZodError, sendError } from '../lib/errors.js';

export async function dealTeamRoutes(app: FastifyInstance) {
  // GET /deal-rooms/:dealRoomId - list team members for deal room
  app.get('/deal-rooms/:dealRoomId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { dealRoomId } = request.params as { dealRoomId: string };
      const db = getDb();

      const rows = await db
        .select({
          member: dealTeamMembers,
          userEmail: users.email,
          userDisplayName: users.displayName,
        })
        .from(dealTeamMembers)
        .innerJoin(users, eq(dealTeamMembers.userId, users.id))
        .where(eq(dealTeamMembers.dealRoomId, dealRoomId));

      const data = rows.map((row) => ({
        ...row.member,
        userEmail: row.userEmail,
        userDisplayName: row.userDisplayName,
      }));

      return reply.send({ success: true, data });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch deal team members');
    }
  });

  // POST /deal-rooms/:dealRoomId - invite member
  app.post('/deal-rooms/:dealRoomId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { dealRoomId } = request.params as { dealRoomId: string };
      const input = InviteDealTeamMemberInputSchema.parse(request.body);
      const db = getDb();

      // Look up user by email
      const [targetUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (!targetUser) return sendError(reply, 404, 'NOT_FOUND', 'User not found');

      // Check if already a member
      const [existing] = await db
        .select()
        .from(dealTeamMembers)
        .where(
          and(
            eq(dealTeamMembers.dealRoomId, dealRoomId),
            eq(dealTeamMembers.userId, targetUser.id),
          ),
        )
        .limit(1);

      if (existing) return sendError(reply, 409, 'ALREADY_MEMBER', 'User is already a team member');

      const [created] = await db
        .insert(dealTeamMembers)
        .values({
          dealRoomId,
          userId: targetUser.id,
          role: input.role,
          pseudonym: input.pseudonym ?? null,
          invitedBy: request.user.userId,
          acceptedAt: null,
        })
        .returning();

      return reply.status(201).send({ success: true, data: created });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to invite team member');
    }
  });

  // PUT /deal-rooms/:dealRoomId/members/:memberId - update role/pseudonym
  app.put('/deal-rooms/:dealRoomId/members/:memberId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { dealRoomId, memberId } = request.params as { dealRoomId: string; memberId: string };
      const input = UpdateDealTeamMemberInputSchema.parse(request.body);
      const db = getDb();

      // Verify requester has lead role in this deal room
      const [requesterMembership] = await db
        .select()
        .from(dealTeamMembers)
        .where(
          and(
            eq(dealTeamMembers.dealRoomId, dealRoomId),
            eq(dealTeamMembers.userId, request.user.userId),
          ),
        )
        .limit(1);

      if (!requesterMembership || requesterMembership.role !== 'lead') {
        return sendError(reply, 403, 'FORBIDDEN', 'Only team leads can update member roles');
      }

      const [existing] = await db
        .select()
        .from(dealTeamMembers)
        .where(and(eq(dealTeamMembers.id, memberId), eq(dealTeamMembers.dealRoomId, dealRoomId)))
        .limit(1);

      if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Team member not found');

      const [updated] = await db
        .update(dealTeamMembers)
        .set({
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.pseudonym !== undefined ? { pseudonym: input.pseudonym } : {}),
        })
        .where(eq(dealTeamMembers.id, memberId))
        .returning();

      return reply.send({ success: true, data: updated });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to update team member');
    }
  });

  // DELETE /deal-rooms/:dealRoomId/members/:memberId - remove member
  app.delete('/deal-rooms/:dealRoomId/members/:memberId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { dealRoomId, memberId } = request.params as { dealRoomId: string; memberId: string };
      const db = getDb();

      const [target] = await db
        .select()
        .from(dealTeamMembers)
        .where(and(eq(dealTeamMembers.id, memberId), eq(dealTeamMembers.dealRoomId, dealRoomId)))
        .limit(1);

      if (!target) return sendError(reply, 404, 'NOT_FOUND', 'Team member not found');

      const isSelf = target.userId === request.user.userId;
      if (!isSelf) {
        // Must be lead to remove others
        const [requesterMembership] = await db
          .select()
          .from(dealTeamMembers)
          .where(
            and(
              eq(dealTeamMembers.dealRoomId, dealRoomId),
              eq(dealTeamMembers.userId, request.user.userId),
            ),
          )
          .limit(1);

        if (!requesterMembership || requesterMembership.role !== 'lead') {
          return sendError(reply, 403, 'FORBIDDEN', 'Only team leads can remove other members');
        }
      }

      await db.delete(dealTeamMembers).where(eq(dealTeamMembers.id, memberId));

      return reply.send({ success: true, data: { removed: true } });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to remove team member');
    }
  });

  // POST /deal-rooms/:dealRoomId/members/:memberId/accept - accept invite
  app.post('/deal-rooms/:dealRoomId/members/:memberId/accept', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { dealRoomId, memberId } = request.params as { dealRoomId: string; memberId: string };
      const db = getDb();

      const [existing] = await db
        .select()
        .from(dealTeamMembers)
        .where(
          and(
            eq(dealTeamMembers.id, memberId),
            eq(dealTeamMembers.userId, request.user.userId),
            eq(dealTeamMembers.dealRoomId, dealRoomId),
          ),
        )
        .limit(1);

      if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Invite not found');

      const [updated] = await db
        .update(dealTeamMembers)
        .set({ acceptedAt: new Date() })
        .where(eq(dealTeamMembers.id, memberId))
        .returning();

      return reply.send({ success: true, data: updated });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to accept invite');
    }
  });
}
