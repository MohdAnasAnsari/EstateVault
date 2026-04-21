import { eq, desc } from 'drizzle-orm';
import { getDb, callLogs } from '@vault/db';
import type { CallType } from '@vault/types';
import { getDealRoomParticipants } from './deal-rooms.js';
import { createNotification } from './notifications.js';
import { aiService } from '@vault/ai';
import { createDealRoomMessage } from './deal-rooms.js';

export class CallError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
  }
}

export async function startCallLog(
  dealRoomId: string,
  initiatedBy: string,
  callType: CallType,
  participantIds: string[],
) {
  const db = getDb();
  const [row] = await db
    .insert(callLogs)
    .values({
      dealRoomId,
      initiatedBy,
      callType,
      participants: participantIds,
      status: 'active',
    })
    .returning();
  return row;
}

export async function endCallLog(callLogId: string, initiatedBy: string) {
  const db = getDb();

  const [existing] = await db
    .select()
    .from(callLogs)
    .where(eq(callLogs.id, callLogId))
    .limit(1);

  if (!existing) throw new CallError('NOT_FOUND', 'Call log not found', 404);

  const endedAt = new Date();
  const durationSeconds = Math.round(
    (endedAt.getTime() - existing.startedAt.getTime()) / 1000,
  );

  const [row] = await db
    .update(callLogs)
    .set({ status: 'ended', endedAt, durationSeconds })
    .where(eq(callLogs.id, callLogId))
    .returning();

  if (!row) throw new CallError('DB_ERROR', 'Failed to update call log');

  await triggerPostCallSummary(row);
  return row;
}

export async function listCallLogs(dealRoomId: string, userId: string) {
  const db = getDb();
  const participants = await getDealRoomParticipants(dealRoomId);
  if (!participants.some((p) => p.userId === userId)) {
    throw new CallError('FORBIDDEN', 'Not a participant', 403);
  }
  return db
    .select()
    .from(callLogs)
    .where(eq(callLogs.dealRoomId, dealRoomId))
    .orderBy(desc(callLogs.startedAt));
}

async function triggerPostCallSummary(callLog: typeof callLogs.$inferSelect) {
  try {
    const durationMin = callLog.durationSeconds ? Math.round(callLog.durationSeconds / 60) : 0;
    const transcript = `${callLog.callType} call, duration ${durationMin} minutes`;
    const summary = await aiService.summariseCall(transcript);

    const systemText = `Call summary: ${durationMin}-min ${callLog.callType} discussion. ${summary.keyPoints.slice(0, 2).join('. ')}. Next steps: ${summary.actionItems[0] ?? 'Review discussed items.'}`;

    await createDealRoomMessage({
      dealRoomId: callLog.dealRoomId,
      senderId: null,
      senderPublicKey: null,
      type: 'system',
      ciphertext: null,
      nonce: null,
      contentPreview: systemText,
    });

    const participants = await getDealRoomParticipants(callLog.dealRoomId);
    for (const participant of participants) {
      await createNotification({
        userId: participant.userId,
        category: 'call',
        title: 'Call summary ready',
        body: systemText.slice(0, 150),
        entityId: callLog.id,
        metadata: { callLogId: callLog.id, durationSeconds: callLog.durationSeconds },
      });
    }
  } catch {
    // Post-call summary is non-critical
  }
}

export function mockGetICEServersConfig() {
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ];
}
