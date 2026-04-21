import { getDb } from '@vault/db';
import { supportTickets } from '@vault/db/schema';
import { aiService } from '@vault/ai';
import { mockSendEmail } from '@vault/mocks';
import type { ConciergeResponse } from '@vault/types';

export async function handleConciergeQuery(
  message: string,
  userId: string | null,
  userEmail: string | null,
): Promise<ConciergeResponse> {
  const response = await aiService.conciergeLookup(message);

  if (response.isHumanHandoff) {
    const db = getDb();
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        userId: userId ?? undefined,
        email: userEmail ?? undefined,
        subject: 'Platform support request via Concierge',
        body: message,
      })
      .returning({ id: supportTickets.id });

    if (userEmail) {
      await mockSendEmail('admin@vault.ae', 'support_ticket_created', {
        ticketId: ticket?.id,
        userEmail,
        message,
      });
    }

    return { ...response, ticketId: ticket?.id ?? null };
  }

  return response;
}
