import { and, count, eq, gt, isNotNull } from 'drizzle-orm';
import { aiService } from '@vault/ai';
import { getDb } from '@vault/db';
import { callLogs, dealRooms, dealRoomFiles, meetings, messages, offers } from '@vault/db/schema';
import type { DealHealthScore } from '@vault/types';

export async function getDealHealthScore(dealRoomId: string): Promise<DealHealthScore> {
  const db = getDb();

  const [room] = await db
    .select({ createdAt: dealRooms.createdAt, lastMessageAt: dealRooms.lastMessageAt })
    .from(dealRooms)
    .where(eq(dealRooms.id, dealRoomId))
    .limit(1);

  if (!room) throw new Error('Deal room not found');

  const daysActive = Math.max(
    1,
    Math.floor((Date.now() - room.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
  );

  const msgRows = await db
    .select({ msgCount: count() })
    .from(messages)
    .where(eq(messages.dealRoomId, dealRoomId));
  const msgCount = msgRows[0]?.msgCount ?? 0;

  const docsRows = await db
    .select({ docsCount: count() })
    .from(dealRoomFiles)
    .where(eq(dealRoomFiles.dealRoomId, dealRoomId));
  const docsCount = docsRows[0]?.docsCount ?? 0;

  const offersRows = await db
    .select({ offersCount: count() })
    .from(offers)
    .where(eq(offers.dealRoomId, dealRoomId));
  const offersCount = offersRows[0]?.offersCount ?? 0;

  const meetingsRows = await db
    .select({ meetingsCount: count() })
    .from(meetings)
    .where(and(eq(meetings.dealRoomId, dealRoomId), eq(meetings.status, 'completed')));
  const meetingsCount = meetingsRows[0]?.meetingsCount ?? 0;

  const daysSinceLastMessage = room.lastMessageAt
    ? Math.floor((Date.now() - room.lastMessageAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  const messagesPerDay = daysActive > 0 ? msgCount / daysActive : 0;

  const { score, label, recommendation } = aiService.calculateDealHealth({
    messagesCount: msgCount,
    docsUploaded: docsCount,
    offersSubmitted: offersCount,
    meetingsHeld: meetingsCount,
    daysSinceLastMessage,
    daysActive,
  });

  return {
    dealRoomId,
    score,
    label,
    signals: {
      messagesPerDay: Math.round(messagesPerDay * 10) / 10,
      docsUploaded: docsCount,
      offersSubmitted: offersCount,
      meetingsHeld: meetingsCount,
      daysSinceLastMessage,
      daysActive,
    },
    recommendation,
  };
}
