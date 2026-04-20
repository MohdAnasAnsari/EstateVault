import { desc, eq } from 'drizzle-orm';
import { getDb } from '@vault/db';
import { kycSubmissions, users } from '@vault/db/schema';
import { queueAMLScreening } from '../jobs/index.js';

export async function approveKycSubmission(userId: string, reason?: string | null): Promise<void> {
  const db = getDb();
  const [submission] = await db
    .select()
    .from(kycSubmissions)
    .where(eq(kycSubmissions.userId, userId))
    .orderBy(desc(kycSubmissions.submittedAt))
    .limit(1);

  if (!submission) return;

  const reviewedAt = new Date();
  await db
    .update(kycSubmissions)
    .set({
      status: 'approved',
      reviewedAt,
      reviewReason: reason ?? submission.reviewReason ?? null,
    })
    .where(eq(kycSubmissions.id, submission.id));

  await db
    .update(users)
    .set({
      kycStatus: 'approved',
      accessTier: 'level_3',
      updatedAt: reviewedAt,
    })
    .where(eq(users.id, userId));

  await queueAMLScreening(userId);
}

export async function rejectKycSubmission(userId: string, reason?: string | null): Promise<void> {
  const db = getDb();
  const [submission] = await db
    .select()
    .from(kycSubmissions)
    .where(eq(kycSubmissions.userId, userId))
    .orderBy(desc(kycSubmissions.submittedAt))
    .limit(1);

  if (!submission) return;

  const reviewedAt = new Date();
  await db
    .update(kycSubmissions)
    .set({
      status: 'rejected',
      reviewedAt,
      reviewReason: reason ?? submission.reviewReason ?? null,
    })
    .where(eq(kycSubmissions.id, submission.id));

  await db
    .update(users)
    .set({
      kycStatus: 'rejected',
      updatedAt: reviewedAt,
    })
    .where(eq(users.id, userId));
}
