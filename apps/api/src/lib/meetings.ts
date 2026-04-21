import { eq, and } from 'drizzle-orm';
import {
  getDb,
  meetingRequests,
  meetingAvailability,
  meetings,
  dealRoomParticipants,
} from '@vault/db';
import type { MeetingType } from '@vault/types';
import { createNotification } from './notifications.js';
import { getDealRoomParticipants } from './deal-rooms.js';

export class MeetingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
  }
}

export async function createMeetingRequest(
  dealRoomId: string,
  requestedBy: string,
  input: { meetingType: MeetingType; durationMinutes: number; timezone: string },
) {
  const db = getDb();

  const participants = await getDealRoomParticipants(dealRoomId);
  const isMember = participants.some((p) => p.userId === requestedBy);
  if (!isMember) throw new MeetingError('FORBIDDEN', 'Not a participant', 403);

  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(meetingRequests)
    .values({
      dealRoomId,
      requestedBy,
      meetingType: input.meetingType,
      durationMinutes: input.durationMinutes,
      timezone: input.timezone,
      expiresAt: expires,
    })
    .returning();

  if (!row) throw new MeetingError('DB_ERROR', 'Failed to create meeting request');

  const requesterParticipant = participants.find((p) => p.userId === requestedBy);
  const otherParticipants = participants.filter((p) => p.userId !== requestedBy);

  for (const participant of otherParticipants) {
    await createNotification({
      userId: participant.userId,
      category: 'meeting',
      title: 'Meeting request received',
      body: `${requesterParticipant?.pseudonym ?? 'A participant'} wants to schedule a ${input.meetingType.replace(/_/g, ' ')} (${input.durationMinutes} min).`,
      entityId: row.id,
      metadata: { meetingRequestId: row.id, dealRoomId },
    });
  }

  return row;
}

export async function submitAvailability(
  meetingRequestId: string,
  userId: string,
  slots: string[],
) {
  const db = getDb();

  const [request] = await db
    .select()
    .from(meetingRequests)
    .where(eq(meetingRequests.id, meetingRequestId))
    .limit(1);

  if (!request) throw new MeetingError('NOT_FOUND', 'Meeting request not found', 404);
  if (request.status !== 'pending') {
    throw new MeetingError('INVALID_STATE', 'Meeting request is no longer pending');
  }

  const participants = await getDealRoomParticipants(request.dealRoomId);
  if (!participants.some((p) => p.userId === userId)) {
    throw new MeetingError('FORBIDDEN', 'Not a participant', 403);
  }

  if (request.requestedBy === userId) {
    throw new MeetingError('INVALID_ACTION', 'Initiator cannot submit availability to their own request');
  }

  const [row] = await db
    .insert(meetingAvailability)
    .values({ meetingRequestId, userId, slots })
    .onConflictDoUpdate({
      target: [meetingAvailability.meetingRequestId, meetingAvailability.userId],
      set: { slots },
    })
    .returning();

  if (!row) throw new MeetingError('DB_ERROR', 'Failed to save availability');

  const confirmed = await tryConfirmMeeting(meetingRequestId, request);
  return { availability: row, confirmedMeeting: confirmed };
}

async function tryConfirmMeeting(
  meetingRequestId: string,
  request: typeof meetingRequests.$inferSelect,
) {
  const db = getDb();

  const allAvailability = await db
    .select()
    .from(meetingAvailability)
    .where(eq(meetingAvailability.meetingRequestId, meetingRequestId));

  const initiatorSlots = allAvailability.find((a) => a.userId === request.requestedBy);
  const otherSlots = allAvailability.filter((a) => a.userId !== request.requestedBy);

  if (!initiatorSlots || otherSlots.length === 0) return null;

  const initiatorSet = new Set(initiatorSlots.slots);
  let overlap: string | null = null;

  for (const avail of otherSlots) {
    const found = avail.slots.find((slot) => initiatorSet.has(slot));
    if (found) {
      overlap = found;
      break;
    }
  }

  if (!overlap) return null;

  const icsUid = `vault-meeting-${meetingRequestId}-${Date.now()}@vault.local`;

  const [meeting] = await db
    .insert(meetings)
    .values({
      meetingRequestId,
      dealRoomId: request.dealRoomId,
      meetingType: request.meetingType,
      scheduledAt: new Date(overlap),
      durationMinutes: request.durationMinutes,
      timezone: request.timezone,
      icsUid,
      status: 'confirmed',
    })
    .returning();

  if (!meeting) return null;

  await db
    .update(meetingRequests)
    .set({ status: 'confirmed' })
    .where(eq(meetingRequests.id, meetingRequestId));

  const participants = await getDealRoomParticipants(request.dealRoomId);
  for (const participant of participants) {
    await createNotification({
      userId: participant.userId,
      category: 'meeting',
      title: 'Meeting confirmed',
      body: `Your ${request.meetingType.replace(/_/g, ' ')} is confirmed for ${new Date(overlap).toLocaleString('en-US', { timeZone: request.timezone, dateStyle: 'medium', timeStyle: 'short' })}.`,
      entityId: meeting.id,
      metadata: { meetingId: meeting.id, scheduledAt: overlap, dealRoomId: request.dealRoomId },
    });
  }

  return meeting;
}

export async function getMeetingRequestDetail(meetingRequestId: string, userId: string) {
  const db = getDb();

  const [request] = await db
    .select()
    .from(meetingRequests)
    .where(eq(meetingRequests.id, meetingRequestId))
    .limit(1);

  if (!request) throw new MeetingError('NOT_FOUND', 'Not found', 404);

  const participants = await getDealRoomParticipants(request.dealRoomId);
  if (!participants.some((p) => p.userId === userId)) {
    throw new MeetingError('FORBIDDEN', 'Not a participant', 403);
  }

  const myAvailability = await db
    .select()
    .from(meetingAvailability)
    .where(
      and(
        eq(meetingAvailability.meetingRequestId, meetingRequestId),
        eq(meetingAvailability.userId, userId),
      ),
    )
    .limit(1);

  const confirmedMeeting = await db
    .select()
    .from(meetings)
    .where(eq(meetings.meetingRequestId, meetingRequestId))
    .limit(1);

  return {
    ...request,
    myAvailability: myAvailability[0] ?? null,
    confirmedMeeting: confirmedMeeting[0] ?? null,
  };
}

export async function listDealRoomMeetingRequests(dealRoomId: string, userId: string) {
  const db = getDb();

  const participants = await getDealRoomParticipants(dealRoomId);
  if (!participants.some((p) => p.userId === userId)) {
    throw new MeetingError('FORBIDDEN', 'Not a participant', 403);
  }

  return db
    .select()
    .from(meetingRequests)
    .where(eq(meetingRequests.dealRoomId, dealRoomId))
    .orderBy(meetingRequests.createdAt);
}

export async function cancelMeetingRequest(meetingRequestId: string, userId: string) {
  const db = getDb();

  const [request] = await db
    .select()
    .from(meetingRequests)
    .where(eq(meetingRequests.id, meetingRequestId))
    .limit(1);

  if (!request) throw new MeetingError('NOT_FOUND', 'Not found', 404);

  const participants = await getDealRoomParticipants(request.dealRoomId);
  if (!participants.some((p) => p.userId === userId)) {
    throw new MeetingError('FORBIDDEN', 'Not a participant', 403);
  }

  const [updated] = await db
    .update(meetingRequests)
    .set({ status: 'cancelled' })
    .where(eq(meetingRequests.id, meetingRequestId))
    .returning();

  return updated ?? null;
}

export function generateICS(meeting: typeof meetings.$inferSelect): string {
  const start = new Date(meeting.scheduledAt);
  const end = new Date(start.getTime() + meeting.durationMinutes * 60 * 1000);

  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');

  const typeLabel = meeting.meetingType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VAULT//Meeting//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${meeting.icsUid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:VAULT Meeting — ${typeLabel}`,
    `DESCRIPTION:Confidential VAULT deal room meeting. All parties are referenced by pseudonym.`,
    `ORGANIZER;CN=VAULT Meeting:mailto:noreply@vault.local`,
    `STATUS:CONFIRMED`,
    `TRANSP:OPAQUE`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
