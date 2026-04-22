/**
 * Email Templates Library
 * Returns { subject, html, text } for each notification type.
 * All templates use inline CSS for maximum email client compatibility.
 */

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

// ─── Base Layout ──────────────────────────────────────────────────────────────

function baseLayout(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#0f0f0f;padding:24px 40px;text-align:center;">
              <span style="color:#d4af37;font-size:24px;font-weight:700;letter-spacing:4px;">VAULT</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #ebebeb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                © ${new Date().getFullYear()} VAULT. All rights reserved.<br/>
                This is an automated message. Please do not reply directly to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function primaryButton(text: string, url: string): string {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:#d4af37;color:#0f0f0f;font-weight:700;font-size:14px;padding:14px 28px;border-radius:6px;text-decoration:none;margin-top:24px;">${escapeHtml(text)}</a>`;
}

function headingHtml(text: string): string {
  return `<h1 style="margin:0 0 16px 0;color:#0f0f0f;font-size:22px;font-weight:700;">${escapeHtml(text)}</h1>`;
}

function paragraphHtml(text: string): string {
  return `<p style="margin:0 0 16px 0;color:#374151;font-size:15px;line-height:1.6;">${escapeHtml(text)}</p>`;
}

function highlightBox(content: string): string {
  return `<div style="background:#f9f7f0;border-left:4px solid #d4af37;padding:16px 20px;margin:20px 0;border-radius:0 6px 6px 0;">${content}</div>`;
}

// ─── Template: KYC Approved ───────────────────────────────────────────────────

export function kycApprovedTemplate(userName: string): EmailTemplate {
  const subject = 'Your VAULT Identity Has Been Verified';

  const bodyContent = `
    ${headingHtml('Identity Verification Complete')}
    ${paragraphHtml(`Congratulations, ${userName}!`)}
    ${paragraphHtml('Your identity has been successfully verified. You now have full access to the VAULT platform, including:')}
    ${highlightBox(`
      <ul style="margin:0;padding:0 0 0 20px;color:#374151;font-size:14px;line-height:2;">
        <li>Access to verified off-market listings</li>
        <li>Ability to enter deal rooms and sign NDAs</li>
        <li>Submit and receive offers</li>
        <li>Full portfolio tracking</li>
      </ul>
    `)}
    ${paragraphHtml('Welcome to the world\'s most exclusive real estate marketplace.')}
    ${primaryButton('Explore Listings', 'https://app.vault.example.com/listings')}
  `;

  const text = `Congratulations, ${userName}!

Your VAULT identity has been verified. You now have full access to the platform including off-market listings, deal rooms, NDAs, and offers.

Visit: https://app.vault.example.com/listings`;

  return { subject, html: baseLayout(subject, bodyContent), text };
}

// ─── Template: Listing Activated ──────────────────────────────────────────────

export function listingActivatedTemplate(
  buyerName: string,
  listingTitle: string,
  listingUrl: string,
): EmailTemplate {
  const subject = `New Listing Match: ${listingTitle}`;

  const bodyContent = `
    ${headingHtml('A New Listing Matches Your Preferences')}
    ${paragraphHtml(`Hello ${buyerName},`)}
    ${paragraphHtml('Our AI has found a new listing that closely matches your investment preferences:')}
    ${highlightBox(`<p style="margin:0;color:#0f0f0f;font-weight:600;font-size:16px;">${escapeHtml(listingTitle)}</p>`)}
    ${paragraphHtml('Review the full listing details and express interest to open a confidential deal room.')}
    ${primaryButton('View Listing', listingUrl)}
    ${paragraphHtml('This match was generated by VAULT\'s AI matching engine based on your stated preferences.')}
  `;

  const text = `Hello ${buyerName},

A new listing matching your preferences is now available on VAULT:

${listingTitle}

View it here: ${listingUrl}`;

  return { subject, html: baseLayout(subject, bodyContent), text };
}

// ─── Template: Deal Room Created ──────────────────────────────────────────────

export function dealRoomCreatedTemplate(
  sellerName: string,
  buyerName: string,
  listingTitle: string,
): EmailTemplate {
  const subject = `New Deal Room: ${listingTitle}`;

  const bodyContent = `
    ${headingHtml('A Buyer Has Expressed Interest')}
    ${paragraphHtml(`Hello ${sellerName},`)}
    ${paragraphHtml(`A qualified buyer has expressed interest in your listing and a confidential deal room has been created:`)}
    ${highlightBox(`
      <p style="margin:0 0 8px 0;color:#6b7280;font-size:13px;">LISTING</p>
      <p style="margin:0;color:#0f0f0f;font-weight:600;font-size:16px;">${escapeHtml(listingTitle)}</p>
      <p style="margin:8px 0 0 0;color:#6b7280;font-size:13px;">BUYER PSEUDONYM</p>
      <p style="margin:0;color:#0f0f0f;font-size:15px;">${escapeHtml(buyerName)}</p>
    `)}
    ${paragraphHtml('The deal room is end-to-end encrypted. You can exchange messages, share documents, and negotiate offers in complete privacy.')}
    ${primaryButton('Enter Deal Room', 'https://app.vault.example.com/deal-rooms')}
  `;

  const text = `Hello ${sellerName},

A buyer (${buyerName}) has expressed interest in your listing "${listingTitle}".

A confidential deal room has been created. Visit: https://app.vault.example.com/deal-rooms`;

  return { subject, html: baseLayout(subject, bodyContent), text };
}

// ─── Template: NDA Signed ─────────────────────────────────────────────────────

export function ndaSignedTemplate(
  partyName: string,
  counterpartyName: string,
  listingTitle: string,
): EmailTemplate {
  const subject = `NDA Confirmed: ${listingTitle}`;

  const bodyContent = `
    ${headingHtml('NDA Signed by Both Parties')}
    ${paragraphHtml(`Hello ${partyName},`)}
    ${paragraphHtml('The Non-Disclosure Agreement for the following listing has been signed by both parties:')}
    ${highlightBox(`
      <p style="margin:0 0 8px 0;color:#6b7280;font-size:13px;">LISTING</p>
      <p style="margin:0;color:#0f0f0f;font-weight:600;font-size:16px;">${escapeHtml(listingTitle)}</p>
      <p style="margin:8px 0 0 0;color:#6b7280;font-size:13px;">COUNTERPARTY</p>
      <p style="margin:0;color:#0f0f0f;font-size:15px;">${escapeHtml(counterpartyName)}</p>
    `)}
    ${paragraphHtml('Full property details, address, and commercial data are now unlocked in your deal room. The signed NDA has been recorded with a tamper-evident signature hash.')}
    ${primaryButton('View Deal Room', 'https://app.vault.example.com/deal-rooms')}
  `;

  const text = `Hello ${partyName},

The NDA for "${listingTitle}" has been signed by both parties (counterparty: ${counterpartyName}).

Full property details are now unlocked. Visit: https://app.vault.example.com/deal-rooms`;

  return { subject, html: baseLayout(subject, bodyContent), text };
}

// ─── Template: Offer Submitted ────────────────────────────────────────────────

export function offerSubmittedTemplate(
  recipientName: string,
  offerAmount: string | number,
  listingTitle: string,
): EmailTemplate {
  const formattedAmount =
    typeof offerAmount === 'number'
      ? offerAmount.toLocaleString('en-AE', { style: 'currency', currency: 'AED' })
      : offerAmount;

  const subject = `New Offer Received: ${listingTitle}`;

  const bodyContent = `
    ${headingHtml('You Have Received a New Offer')}
    ${paragraphHtml(`Hello ${recipientName},`)}
    ${paragraphHtml('A new offer has been submitted in your deal room:')}
    ${highlightBox(`
      <p style="margin:0 0 8px 0;color:#6b7280;font-size:13px;">LISTING</p>
      <p style="margin:0;color:#0f0f0f;font-weight:600;font-size:16px;">${escapeHtml(listingTitle)}</p>
      <p style="margin:8px 0 0 0;color:#6b7280;font-size:13px;">OFFER AMOUNT</p>
      <p style="margin:0;color:#0f0f0f;font-size:22px;font-weight:700;">${escapeHtml(String(formattedAmount))}</p>
    `)}
    ${paragraphHtml('Log in to review the full offer terms, counter-offer, or accept.')}
    ${primaryButton('Review Offer', 'https://app.vault.example.com/deal-rooms')}
  `;

  const text = `Hello ${recipientName},

A new offer of ${formattedAmount} has been submitted for your listing "${listingTitle}".

Review it at: https://app.vault.example.com/deal-rooms`;

  return { subject, html: baseLayout(subject, bodyContent), text };
}

// ─── Template: Liveness Warning ───────────────────────────────────────────────

export function livenessWarningTemplate(
  sellerName: string,
  listingTitle: string,
  daysSinceUpdate: number,
): EmailTemplate {
  const subject = `Action Required: Update Your Listing`;

  const bodyContent = `
    ${headingHtml('Your Listing Needs Attention')}
    ${paragraphHtml(`Hello ${sellerName},`)}
    ${paragraphHtml(`Your listing has not been updated in ${daysSinceUpdate} days. VAULT requires periodic confirmation that listings remain active and accurate.`)}
    ${highlightBox(`
      <p style="margin:0 0 8px 0;color:#6b7280;font-size:13px;">LISTING</p>
      <p style="margin:0;color:#0f0f0f;font-weight:600;font-size:16px;">${escapeHtml(listingTitle)}</p>
      <p style="margin:8px 0 0 0;color:#ef4444;font-size:13px;">Days since last update: <strong>${daysSinceUpdate}</strong></p>
    `)}
    ${paragraphHtml('Please log in and confirm your listing details are still accurate, or update any changed information. Listings that are not confirmed within 30 days may be automatically paused.')}
    ${primaryButton('Update Listing', 'https://app.vault.example.com/listings')}
  `;

  const text = `Hello ${sellerName},

Your listing "${listingTitle}" has not been updated in ${daysSinceUpdate} days.

Please log in to confirm or update: https://app.vault.example.com/listings`;

  return { subject, html: baseLayout(subject, bodyContent), text };
}

// ─── Template Dispatcher ──────────────────────────────────────────────────────

/**
 * Get the appropriate email template for an event type.
 * Falls back to a generic template for unknown events.
 */
export function getEmailTemplate(
  templateKey: string,
  data: Record<string, unknown>,
): EmailTemplate {
  const userName = String(data['userName'] ?? 'Valued Member');
  const title = String(data['title'] ?? 'VAULT Notification');
  const body = String(data['body'] ?? '');

  switch (templateKey) {
    case 'kyc_approved':
      return kycApprovedTemplate(userName);

    case 'listing_activated':
      return listingActivatedTemplate(
        userName,
        String(data['listingTitle'] ?? 'New Listing'),
        String(data['listingUrl'] ?? 'https://app.vault.example.com/listings'),
      );

    case 'deal_room_created':
      return dealRoomCreatedTemplate(
        userName,
        String(data['buyerPseudonym'] ?? 'A buyer'),
        String(data['listingTitle'] ?? 'your listing'),
      );

    case 'nda_signed':
      return ndaSignedTemplate(
        userName,
        String(data['counterpartyName'] ?? 'Counterparty'),
        String(data['listingTitle'] ?? 'the listing'),
      );

    case 'offer_submitted':
      return offerSubmittedTemplate(
        userName,
        (data['offerAmount'] as string | number | undefined) ?? 'N/A',
        String(data['listingTitle'] ?? 'the listing'),
      );

    case 'liveness_warning':
      return livenessWarningTemplate(
        userName,
        String(data['listingTitle'] ?? 'your listing'),
        Number(data['daysSinceUpdate'] ?? 0),
      );

    default:
      // Generic fallback template
      return {
        subject: title,
        html: baseLayout(
          title,
          `${headingHtml(title)}${paragraphHtml(body)}`,
        ),
        text: `${title}\n\n${body}`,
      };
  }
}
