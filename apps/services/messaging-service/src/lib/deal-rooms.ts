import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  generateRawKeyPair,
  encryptSymmetric,
  decryptSymmetric,
  generateAES256Key,
  type EncryptedData,
} from '@vault/crypto';
import { getDb } from '@vault/db';
import {
  dealRooms,
  dealRoomParticipants,
  messages,
  dealRoomFiles,
  offers,
  ndas,
  meetingRequests,
} from '@vault/db';
import { eq, and, gte, count, sql } from 'drizzle-orm';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoomKeyPair {
  publicKey: string;
  symmetricKey: string;
}

export interface DealHealthSignals {
  messagesLast7Days: number;
  docsUploaded: number;
  activeOffers: number;
  meetingsScheduled: number;
  ndaSigned: boolean;
  participantCount: number;
  daysSinceLastMessage: number | null;
}

export interface DealHealthResult {
  score: number;
  grade: 'hot' | 'warm' | 'cooling' | 'stalled';
  signals: DealHealthSignals;
}

export type DealStage =
  | 'interest_expressed'
  | 'pending_nda'
  | 'nda_signed'
  | 'due_diligence'
  | 'offer_submitted'
  | 'offer_accepted'
  | 'closed';

export interface NdaParty {
  participantId: string;
  pseudonym: string;
  role: string;
  signedAt: string | null;
  signatureHash: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ADJECTIVES = [
  'Ghost', 'Silent', 'Iron', 'Shadow', 'Crimson', 'Azure', 'Ivory', 'Obsidian',
  'Amber', 'Sapphire', 'Onyx', 'Golden', 'Silver', 'Scarlet', 'Cobalt',
  'Emerald', 'Jade', 'Pearl', 'Ruby', 'Topaz',
];

const NOUNS = [
  'Hawk', 'Wolf', 'Fox', 'Eagle', 'Falcon', 'Raven', 'Panther', 'Lynx',
  'Phoenix', 'Dragon', 'Sphinx', 'Griffon', 'Condor', 'Jaguar', 'Viper',
  'Cobra', 'Titan', 'Oracle', 'Cipher', 'Wraith',
];

// Valid stage transitions
const STAGE_TRANSITIONS: Record<DealStage, DealStage[]> = {
  interest_expressed: ['pending_nda'],
  pending_nda: ['nda_signed'],
  nda_signed: ['due_diligence'],
  due_diligence: ['offer_submitted'],
  offer_submitted: ['offer_accepted'],
  offer_accepted: ['closed'],
  closed: [],
};

// ─── Key generation ───────────────────────────────────────────────────────────

/**
 * Generates a keypair for the room. The room's symmetric key is used for
 * encrypting messages at rest. The asymmetric keypair is used for key wrapping.
 */
export async function generateRoomKeys(): Promise<RoomKeyPair> {
  const keyPair = await generateRawKeyPair();
  const symmetricKey = await generateAES256Key();
  return {
    publicKey: keyPair.publicKey,
    symmetricKey,
  };
}

// ─── Pseudonym generation ─────────────────────────────────────────────────────

/**
 * Generates a deterministic, human-readable pseudonym for a user within a
 * deal room. The pseudonym is stable: same userId + roomId always yields the
 * same pseudonym, preventing identity correlation across rooms.
 */
export function generatePseudonym(userId: string, roomId: string): string {
  // Deterministic hash: XOR bytes of both IDs
  const combined = userId + ':' + roomId;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // convert to 32-bit integer
  }

  const absHash = Math.abs(hash);
  const adjIdx = absHash % ADJECTIVES.length;
  const nounIdx = Math.floor(absHash / ADJECTIVES.length) % NOUNS.length;
  const suffix = (absHash % 9000) + 1000; // 1000–9999

  const adjective = ADJECTIVES[adjIdx] ?? 'Ghost';
  const noun = NOUNS[nounIdx] ?? 'Hawk';

  return `${adjective} ${noun} #${suffix}`;
}

// ─── Message encryption ───────────────────────────────────────────────────────

/**
 * Encrypts a message using the room's symmetric key.
 */
export async function encryptMessage(
  content: string,
  roomSymmetricKey: string,
): Promise<EncryptedData> {
  return encryptSymmetric(content, roomSymmetricKey);
}

/**
 * Decrypts a message using the room's symmetric key.
 */
export async function decryptMessage(
  encryptedContent: EncryptedData,
  roomSymmetricKey: string,
): Promise<string> {
  return decryptSymmetric(encryptedContent, roomSymmetricKey);
}

// ─── Deal health scoring ──────────────────────────────────────────────────────

/**
 * Calculates a deal health score from 0–100 with a breakdown of signals.
 * Weights:
 *   - Message activity (7 days): 30 pts
 *   - Documents uploaded: 20 pts
 *   - Active offers: 25 pts
 *   - Meetings scheduled: 15 pts
 *   - NDA signed: 10 pts
 */
export async function calculateDealHealth(
  roomId: string,
  db: ReturnType<typeof getDb>,
): Promise<DealHealthResult> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [recentMessages, totalDocs, activeOffers, scheduledMeetings, room, participantRows] =
    await Promise.all([
      db
        .select({ cnt: count() })
        .from(messages)
        .where(
          and(
            eq(messages.dealRoomId, roomId),
            gte(messages.createdAt, sevenDaysAgo),
          ),
        ),
      db
        .select({ cnt: count() })
        .from(dealRoomFiles)
        .where(eq(dealRoomFiles.dealRoomId, roomId)),
      db
        .select({ cnt: count() })
        .from(offers)
        .where(
          and(
            eq(offers.dealRoomId, roomId),
            sql`${offers.status} IN ('submitted', 'countered')`,
          ),
        ),
      db
        .select({ cnt: count() })
        .from(meetingRequests)
        .where(
          and(
            eq(meetingRequests.dealRoomId, roomId),
            sql`${meetingRequests.status} IN ('pending', 'confirmed')`,
          ),
        ),
      db
        .select({
          ndaStatus: dealRooms.ndaStatus,
          lastMessageAt: dealRooms.lastMessageAt,
        })
        .from(dealRooms)
        .where(eq(dealRooms.id, roomId))
        .limit(1),
      db
        .select({ cnt: count() })
        .from(dealRoomParticipants)
        .where(eq(dealRoomParticipants.dealRoomId, roomId)),
    ]);

  const msgCount = recentMessages[0]?.cnt ?? 0;
  const docCount = totalDocs[0]?.cnt ?? 0;
  const offerCount = activeOffers[0]?.cnt ?? 0;
  const meetingCount = scheduledMeetings[0]?.cnt ?? 0;
  const roomData = room[0];
  const pCount = participantRows[0]?.cnt ?? 0;

  const ndaSigned = roomData?.ndaStatus === 'signed';
  const lastMessageAt = roomData?.lastMessageAt ?? null;
  const daysSinceLastMessage = lastMessageAt
    ? Math.floor((now.getTime() - lastMessageAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Score components (capped)
  const msgScore = Math.min(30, Number(msgCount) * 3);
  const docScore = Math.min(20, Number(docCount) * 4);
  const offerScore = Math.min(25, Number(offerCount) * 12);
  const meetingScore = Math.min(15, Number(meetingCount) * 7);
  const ndaScore = ndaSigned ? 10 : 0;

  const rawScore = msgScore + docScore + offerScore + meetingScore + ndaScore;

  // Apply staleness penalty if no messages in 7 days
  const stalePenalty =
    daysSinceLastMessage !== null && daysSinceLastMessage > 7
      ? Math.min(20, (daysSinceLastMessage - 7) * 2)
      : 0;

  const score = Math.max(0, Math.min(100, rawScore - stalePenalty));

  let grade: DealHealthResult['grade'];
  if (score >= 75) grade = 'hot';
  else if (score >= 50) grade = 'warm';
  else if (score >= 25) grade = 'cooling';
  else grade = 'stalled';

  return {
    score,
    grade,
    signals: {
      messagesLast7Days: Number(msgCount),
      docsUploaded: Number(docCount),
      activeOffers: Number(offerCount),
      meetingsScheduled: Number(meetingCount),
      ndaSigned,
      participantCount: Number(pCount),
      daysSinceLastMessage,
    },
  };
}

// ─── NDA PDF generation ───────────────────────────────────────────────────────

/**
 * Generates a signed NDA PDF using pdf-lib.
 * Returns the PDF as a Uint8Array ready for storage/download.
 */
export async function generateNdaPdf(
  nda: {
    id: string;
    dealRoomId: string;
    templateVersion: string;
    parties: NdaParty[];
    status: string;
  },
  signerName: string,
  timestamp: Date,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const margin = 60;
  let y = height - margin;

  const drawText = (
    text: string,
    options: {
      size?: number;
      font?: typeof fontBold;
      color?: ReturnType<typeof rgb>;
      indent?: number;
    } = {},
  ) => {
    const {
      size = 10,
      font = fontRegular,
      color = rgb(0, 0, 0),
      indent = 0,
    } = options;
    page.drawText(text, {
      x: margin + indent,
      y,
      size,
      font,
      color,
      maxWidth: width - margin * 2 - indent,
    });
    y -= size + 6;
  };

  const drawDivider = () => {
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
    y -= 12;
  };

  // ── Header ────────────────────────────────────────────────────────────────
  drawText('NON-DISCLOSURE AGREEMENT', {
    size: 18,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.4),
  });
  y -= 4;
  drawText('EstateVault Secure Deal Room', {
    size: 11,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 8;
  drawDivider();

  // ── Metadata ──────────────────────────────────────────────────────────────
  drawText(`Agreement ID: ${nda.id}`, { size: 9, color: rgb(0.5, 0.5, 0.5) });
  drawText(`Deal Room: ${nda.dealRoomId}`, { size: 9, color: rgb(0.5, 0.5, 0.5) });
  drawText(`Template Version: ${nda.templateVersion}`, { size: 9, color: rgb(0.5, 0.5, 0.5) });
  drawText(`Generated: ${timestamp.toISOString()}`, { size: 9, color: rgb(0.5, 0.5, 0.5) });
  y -= 8;
  drawDivider();

  // ── Body ──────────────────────────────────────────────────────────────────
  drawText('1. PURPOSE', { size: 12, font: fontBold });
  y -= 2;
  drawText(
    'This Non-Disclosure Agreement ("Agreement") is entered into between the parties listed ' +
    'below in connection with the evaluation of a potential real estate transaction facilitated ' +
    'through the EstateVault secure deal room platform. All information shared within the deal ' +
    'room is confidential and subject to the terms of this Agreement.',
    { size: 10, indent: 10 },
  );
  y -= 8;

  drawText('2. CONFIDENTIAL INFORMATION', { size: 12, font: fontBold });
  y -= 2;
  drawText(
    '"Confidential Information" means any and all non-public information disclosed by one party ' +
    'to another through the EstateVault platform, including but not limited to: financial data, ' +
    'property documents, due diligence materials, offer terms, and communications within the ' +
    'deal room.',
    { size: 10, indent: 10 },
  );
  y -= 8;

  drawText('3. OBLIGATIONS', { size: 12, font: fontBold });
  y -= 2;
  drawText(
    'Each receiving party agrees to: (a) hold Confidential Information in strict confidence; ' +
    '(b) not disclose Confidential Information to any third party without prior written consent; ' +
    '(c) use Confidential Information solely to evaluate the potential transaction; and ' +
    '(d) promptly notify the disclosing party of any unauthorised disclosure.',
    { size: 10, indent: 10 },
  );
  y -= 8;

  drawText('4. TERM', { size: 12, font: fontBold });
  y -= 2;
  drawText(
    'This Agreement shall remain in effect for a period of three (3) years from the date of ' +
    'signing, or until the transaction is completed or terminated, whichever occurs first.',
    { size: 10, indent: 10 },
  );
  y -= 8;

  drawText('5. GOVERNING LAW', { size: 12, font: fontBold });
  y -= 2;
  drawText(
    'This Agreement shall be governed by the laws of the United Arab Emirates. Any disputes ' +
    'arising from this Agreement shall be subject to the exclusive jurisdiction of the courts ' +
    'of Dubai, UAE.',
    { size: 10, indent: 10 },
  );
  y -= 16;
  drawDivider();

  // ── Parties & signatures ──────────────────────────────────────────────────
  drawText('PARTIES AND SIGNATURES', { size: 12, font: fontBold });
  y -= 4;

  for (const party of nda.parties) {
    drawText(`Party: ${party.pseudonym}`, { size: 10, font: fontBold, indent: 10 });
    drawText(`Role: ${party.role}`, { size: 10, indent: 10 });
    if (party.signedAt) {
      drawText(`Signed at: ${party.signedAt}`, { size: 10, indent: 10 });
      drawText(`Signature hash: ${party.signatureHash ?? 'N/A'}`, {
        size: 8,
        indent: 10,
        color: rgb(0.5, 0.5, 0.5),
      });
    } else {
      drawText('Status: PENDING SIGNATURE', {
        size: 10,
        indent: 10,
        color: rgb(0.8, 0.4, 0),
      });
    }
    y -= 6;
  }

  drawDivider();

  // ── Current signer block ──────────────────────────────────────────────────
  drawText(`Signed by: ${signerName}`, { size: 11, font: fontBold });
  drawText(`Timestamp: ${timestamp.toISOString()}`, { size: 10 });
  y -= 8;

  // ── Footer ────────────────────────────────────────────────────────────────
  page.drawText(
    'This document was digitally generated and signed via the EstateVault platform. ' +
    'Signatures are cryptographically bound to user identities.',
    {
      x: margin,
      y: margin,
      size: 7,
      font: fontRegular,
      color: rgb(0.6, 0.6, 0.6),
      maxWidth: width - margin * 2,
    },
  );

  return pdfDoc.save();
}

// ─── Stage transitions ────────────────────────────────────────────────────────

/**
 * Validates and executes a deal stage transition.
 * Returns the new stage on success, or throws if the transition is invalid.
 */
export async function advanceDealStage(
  roomId: string,
  currentStage: DealStage,
  userId: string,
  db: ReturnType<typeof getDb>,
): Promise<DealStage> {
  const validNextStages = STAGE_TRANSITIONS[currentStage];

  if (!validNextStages || validNextStages.length === 0) {
    throw new Error(`Deal is already in terminal stage: ${currentStage}`);
  }

  const nextStage = validNextStages[0];
  if (!nextStage) {
    throw new Error(`No valid next stage from: ${currentStage}`);
  }

  // Validate preconditions
  if (nextStage === 'nda_signed') {
    const ndaRow = await db
      .select({ status: ndas.status })
      .from(ndas)
      .where(and(eq(ndas.dealRoomId, roomId), sql`${ndas.status} = 'signed'`))
      .limit(1);

    if (ndaRow.length === 0) {
      throw new Error('Cannot advance to nda_signed: NDA has not been fully signed yet');
    }
  }

  if (nextStage === 'offer_accepted') {
    const offerRow = await db
      .select({ status: offers.status })
      .from(offers)
      .where(and(eq(offers.dealRoomId, roomId), sql`${offers.status} = 'accepted'`))
      .limit(1);

    if (offerRow.length === 0) {
      throw new Error('Cannot advance to offer_accepted: No accepted offer found');
    }
  }

  await db
    .update(dealRooms)
    .set({
      status: nextStage as (typeof dealRooms.$inferInsert)['status'],
      stageChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(dealRooms.id, roomId));

  return nextStage;
}
