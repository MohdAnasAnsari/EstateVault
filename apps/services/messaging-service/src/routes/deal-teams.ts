import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import { dealTeamMembers, dealRoomParticipants } from '@vault/db';
import { eq, and } from 'drizzle-orm';
import { generatePseudonym } from '../lib/deal-rooms.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type TeamRole = 'lead' | 'co_investor' | 'legal' | 'financial' | 'observer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(request: FastifyRequest): string {
  const id = request.headers['x-user-id'] as string | undefined;
  if (!id) throw new Error('X-User-Id header is required');
  return id;
}

function ok(reply: FastifyReply, data: unknown, statusCode = 200) {
  return reply.status(statusCode).send({ success: true, data });
}

function errRes(reply: FastifyReply, code: string, message: string, statusCode = 400) {
  return reply.status(statusCode).send({ success: false, error: { code, message } });
}

async function requireParticipant(
  userId: string,
  roomId: string,
  db: ReturnType<typeof getDb>,
) {
  const rows = await db
    .select()
    .from(dealRoomParticipants)
    .where(
      and(
        eq(dealRoomParticipants.dealRoomId, roomId),
        eq(dealRoomParticipants.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const inviteTeamMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['lead', 'co_investor', 'legal', 'financial', 'observer']),
  customPseudonym: z.string().max(100).optional(),
});

const acceptInvitationSchema = z.object({
  invitationId: z.string().uuid(),
});

const updateRoleSchema = z.object({
  role: z.enum(['lead', 'co_investor', 'legal', 'financial', 'observer']),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function dealTeamRoutes(app: FastifyInstance) {
  // GET /deal-rooms/:roomId/team — list team members
  app.get(
    '/deal-rooms/:roomId/team',
    async (
      request: FastifyRequest<{ Params: { roomId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId } = request.params;
      const db = getDb();

      const participant = await requireParticipant(userId, roomId, db);
      if (!participant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      const members = await db
        .select()
        .from(dealTeamMembers)
        .where(eq(dealTeamMembers.dealRoomId, roomId));

      return ok(reply, {
        items: members.map((m) => ({
          id: m.id,
          dealRoomId: m.dealRoomId,
          userId: m.userId,
          role: m.role,
          pseudonym: m.pseudonym,
          invitedBy: m.invitedBy,
          acceptedAt: m.acceptedAt,
          createdAt: m.createdAt,
          status: m.acceptedAt ? 'active' : 'pending',
        })),
      });
    },
  );

  // POST /deal-rooms/:roomId/team/invite — invite team member
  app.post(
    '/deal-rooms/:roomId/team/invite',
    async (
      request: FastifyRequest<{ Params: { roomId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId } = request.params;

      const parsed = inviteTeamMemberSchema.safeParse(request.body);
      if (!parsed.success) {
        return errRes(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const { userId: inviteeId, role, customPseudonym } = parsed.data;
      const db = getDb();

      // Requester must be a participant
      const requestingParticipant = await requireParticipant(userId, roomId, db);
      if (!requestingParticipant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      // Only lead or admin roles can invite
      if (!['admin', 'agent', 'seller', 'buyer'].includes(requestingParticipant.role)) {
        return errRes(reply, 'FORBIDDEN', 'Insufficient permissions to invite team members', 403);
      }

      // Check if already a team member
      const existing = await db
        .select({ id: dealTeamMembers.id })
        .from(dealTeamMembers)
        .where(
          and(
            eq(dealTeamMembers.dealRoomId, roomId),
            eq(dealTeamMembers.userId, inviteeId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        return errRes(reply, 'CONFLICT', 'User is already a team member of this deal room', 409);
      }

      const pseudonym = customPseudonym ?? generatePseudonym(inviteeId, roomId);

      const [member] = await db
        .insert(dealTeamMembers)
        .values({
          dealRoomId: roomId,
          userId: inviteeId,
          role: role as TeamRole,
          pseudonym,
          invitedBy: userId,
          // acceptedAt is null until the invitee accepts
        })
        .returning();

      return ok(
        reply,
        {
          id: member?.id,
          dealRoomId: roomId,
          userId: inviteeId,
          role,
          pseudonym,
          invitedBy: userId,
          status: 'pending',
          createdAt: member?.createdAt,
        },
        201,
      );
    },
  );

  // POST /deal-rooms/:roomId/team/accept — accept invitation
  app.post(
    '/deal-rooms/:roomId/team/accept',
    async (
      request: FastifyRequest<{ Params: { roomId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId } = request.params;

      const parsed = acceptInvitationSchema.safeParse(request.body);
      if (!parsed.success) {
        return errRes(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const { invitationId } = parsed.data;
      const db = getDb();

      // Find the pending invitation for this user
      const [invitation] = await db
        .select()
        .from(dealTeamMembers)
        .where(
          and(
            eq(dealTeamMembers.id, invitationId),
            eq(dealTeamMembers.dealRoomId, roomId),
            eq(dealTeamMembers.userId, userId),
          ),
        )
        .limit(1);

      if (!invitation) {
        return errRes(reply, 'NOT_FOUND', 'Invitation not found or does not belong to you', 404);
      }

      if (invitation.acceptedAt) {
        return errRes(reply, 'CONFLICT', 'Invitation has already been accepted', 409);
      }

      const acceptedAt = new Date();

      const [updated] = await db
        .update(dealTeamMembers)
        .set({ acceptedAt })
        .where(eq(dealTeamMembers.id, invitationId))
        .returning();

      // Also add as a deal room participant if not already
      const existing = await db
        .select({ id: dealRoomParticipants.id })
        .from(dealRoomParticipants)
        .where(
          and(
            eq(dealRoomParticipants.dealRoomId, roomId),
            eq(dealRoomParticipants.userId, userId),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        // Map team role to participant role
        const roleMap: Record<TeamRole, 'buyer' | 'seller' | 'legal_advisor' | 'agent' | 'admin'> = {
          lead: 'buyer',
          co_investor: 'buyer',
          legal: 'legal_advisor',
          financial: 'buyer',
          observer: 'buyer',
        };

        const teamRole = (invitation.role ?? 'observer') as TeamRole;
        await db.insert(dealRoomParticipants).values({
          dealRoomId: roomId,
          userId,
          role: roleMap[teamRole] ?? 'buyer',
          pseudonym: invitation.pseudonym ?? generatePseudonym(userId, roomId),
          identityRevealed: false,
          joinedAt: acceptedAt,
        });
      }

      return ok(reply, {
        id: updated?.id,
        dealRoomId: roomId,
        userId,
        role: updated?.role,
        pseudonym: updated?.pseudonym,
        acceptedAt: updated?.acceptedAt,
        status: 'active',
      });
    },
  );

  // PATCH /deal-rooms/:roomId/team/:memberId/role — update member role
  app.patch(
    '/deal-rooms/:roomId/team/:memberId/role',
    async (
      request: FastifyRequest<{ Params: { roomId: string; memberId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId, memberId } = request.params;

      const parsed = updateRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return errRes(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input');
      }

      const { role } = parsed.data;
      const db = getDb();

      // Requester must be a participant with elevated role
      const requestingParticipant = await requireParticipant(userId, roomId, db);
      if (!requestingParticipant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      if (!['admin', 'agent', 'seller'].includes(requestingParticipant.role)) {
        return errRes(reply, 'FORBIDDEN', 'Insufficient permissions to update team member roles', 403);
      }

      const [member] = await db
        .select()
        .from(dealTeamMembers)
        .where(
          and(
            eq(dealTeamMembers.id, memberId),
            eq(dealTeamMembers.dealRoomId, roomId),
          ),
        )
        .limit(1);

      if (!member) {
        return errRes(reply, 'NOT_FOUND', 'Team member not found', 404);
      }

      const [updated] = await db
        .update(dealTeamMembers)
        .set({ role: role as TeamRole })
        .where(eq(dealTeamMembers.id, memberId))
        .returning();

      return ok(reply, {
        id: updated?.id,
        dealRoomId: roomId,
        userId: updated?.userId,
        role: updated?.role,
        pseudonym: updated?.pseudonym,
        updatedBy: userId,
      });
    },
  );

  // DELETE /deal-rooms/:roomId/team/:memberId — remove member
  app.delete(
    '/deal-rooms/:roomId/team/:memberId',
    async (
      request: FastifyRequest<{ Params: { roomId: string; memberId: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      const { roomId, memberId } = request.params;
      const db = getDb();

      // Requester must be a participant
      const requestingParticipant = await requireParticipant(userId, roomId, db);
      if (!requestingParticipant) {
        return errRes(reply, 'FORBIDDEN', 'Not a participant of this deal room', 403);
      }

      const [member] = await db
        .select()
        .from(dealTeamMembers)
        .where(
          and(
            eq(dealTeamMembers.id, memberId),
            eq(dealTeamMembers.dealRoomId, roomId),
          ),
        )
        .limit(1);

      if (!member) {
        return errRes(reply, 'NOT_FOUND', 'Team member not found', 404);
      }

      // Only admin/agent/seller can remove others; any member can remove themselves
      const isSelf = member.userId === userId;
      const hasElevatedRole = ['admin', 'agent', 'seller'].includes(requestingParticipant.role);

      if (!isSelf && !hasElevatedRole) {
        return errRes(reply, 'FORBIDDEN', 'Insufficient permissions to remove team members', 403);
      }

      await db.delete(dealTeamMembers).where(eq(dealTeamMembers.id, memberId));

      // Also remove from deal room participants
      if (member.userId) {
        await db
          .delete(dealRoomParticipants)
          .where(
            and(
              eq(dealRoomParticipants.dealRoomId, roomId),
              eq(dealRoomParticipants.userId, member.userId),
            ),
          );
      }

      return ok(reply, { deleted: true, memberId });
    },
  );
}
