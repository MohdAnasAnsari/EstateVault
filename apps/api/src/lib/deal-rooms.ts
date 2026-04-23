import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { aiService } from '@vault/ai';
import { getDb } from '@vault/db';
import {
  dealRoomFiles,
  dealRoomParticipants,
  dealRooms,
  listings,
  messages,
  ndas,
  offers,
  users,
} from '@vault/db/schema';
import type {
  AddMessageReactionInput,
  CreateOfferInput,
  DealRoomAssistantContext,
  DealRoomAssistantSuggestion,
  DealRoomDetail,
  DealRoomFile,
  DealRoomMessage,
  DealRoomParticipant,
  DealRoomStatus,
  DealRoomSummary,
  NDA,
  Offer,
  SignNDAInput,
  UploadDealRoomFileInput,
} from '@vault/types';
import {
  serializeDealRoomDetail,
  serializeDealRoomFile,
  serializeDealRoomMessage,
  serializeDealRoomParticipant,
  serializeListing,
  serializeNda,
  serializeOffer,
} from './serializers.js';

export class DealRoomError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function formatSystemTimestamp(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
    .format(date)
    .replace(',', ' \u00b7');
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
}

function getRequiredNdaParticipantIds(participants: typeof dealRoomParticipants.$inferSelect[]): string[] {
  return participants
    .filter((participant) => participant.role === 'buyer' || participant.role === 'seller')
    .map((participant) => participant.id);
}

async function getRoomRow(dealRoomId: string) {
  const db = getDb();
  const [room] = await db.select().from(dealRooms).where(eq(dealRooms.id, dealRoomId)).limit(1);
  if (!room) {
    throw new DealRoomError(404, 'DEAL_ROOM_NOT_FOUND', 'Deal room not found');
  }

  return room;
}

async function getListingRow(listingId: string) {
  const db = getDb();
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  if (!listing) {
    throw new DealRoomError(404, 'LISTING_NOT_FOUND', 'Listing not found');
  }

  return listing;
}

export async function requireDealRoomParticipant(dealRoomId: string, userId: string) {
  const db = getDb();
  const [participant] = await db
    .select()
    .from(dealRoomParticipants)
    .where(and(eq(dealRoomParticipants.dealRoomId, dealRoomId), eq(dealRoomParticipants.userId, userId)))
    .limit(1);

  if (!participant) {
    throw new DealRoomError(403, 'DEAL_ROOM_FORBIDDEN', 'You are not a participant in this deal room');
  }

  return participant;
}

export async function listUserDealRooms(userId: string): Promise<DealRoomSummary[]> {
  const db = getDb();
  const participantRows = await db
    .select()
    .from(dealRoomParticipants)
    .where(eq(dealRoomParticipants.userId, userId));

  if (participantRows.length === 0) return [];

  const roomIds = participantRows.map((row) => row.dealRoomId);
  const roomRows = await db.select().from(dealRooms).where(inArray(dealRooms.id, roomIds));
  const listingRows = await db
    .select()
    .from(listings)
    .where(inArray(listings.id, roomRows.map((row) => row.listingId)));
  const ndaRows = await db.select().from(ndas).where(inArray(ndas.dealRoomId, roomIds));
  const messageRows = await db
    .select()
    .from(messages)
    .where(inArray(messages.dealRoomId, roomIds))
    .orderBy(desc(messages.createdAt));

  const listingById = new Map(listingRows.map((row) => [row.id, row]));
  const ndaByRoomId = new Map(ndaRows.map((row) => [row.dealRoomId, row]));

  return participantRows
    .map((participant) => {
      const room = roomRows.find((item) => item.id === participant.dealRoomId);
      if (!room) return null;

      const listing = listingById.get(room.listingId);
      if (!listing) return null;

      const unreadCount = messageRows.filter(
        (message) =>
          message.dealRoomId === room.id &&
          message.senderId !== userId &&
          !(message.readBy ?? []).some((receipt) => receipt.userId === userId),
      ).length;

      return {
        id: room.id,
        listingId: listing.id,
        listingTitle: listing.title,
        listingSlug: listing.slug,
        listingAssetType: listing.assetType,
        city: listing.city,
        country: listing.country,
        status: room.status,
        ndaStatus: ndaByRoomId.get(room.id)?.status ?? room.ndaStatus,
        participantPseudonym: participant.pseudonym,
        lastMessageAt: room.lastMessageAt?.toISOString() ?? null,
        unreadCount,
        createdAt: room.createdAt.toISOString(),
      } satisfies DealRoomSummary;
    })
    .filter((room): room is DealRoomSummary => room !== null);
}

export async function getOrCreateDealRoomForListing(
  listingId: string,
  requesterId: string,
): Promise<DealRoomDetail> {
  const db = getDb();
  const listing = await getListingRow(listingId);

  if (requesterId === listing.sellerId || requesterId === listing.agentId) {
    throw new DealRoomError(
      409,
      'DEAL_ROOM_SELF_INTEREST_NOT_ALLOWED',
      'This listing is already managed by your account. Buyer deal rooms open when a different qualified user expresses interest.',
    );
  }

  const [existingRoom] = await db
    .select()
    .from(dealRooms)
    .where(
      and(
        eq(dealRooms.listingId, listingId),
        eq(dealRooms.buyerId, requesterId),
      ),
    )
    .limit(1);

  if (existingRoom) {
    return getDealRoomDetail(existingRoom.id, requesterId);
  }

  const [createdRoom] = await db
    .insert(dealRooms)
    .values({
      listingId: listing.id,
      buyerId: requesterId,
      sellerId: listing.sellerId,
      agentId: listing.agentId ?? null,
      createdById: requesterId,
      status: 'interest_expressed',
      ndaStatus: 'pending',
    })
    .returning();

  if (!createdRoom) {
    throw new DealRoomError(500, 'DEAL_ROOM_CREATE_FAILED', 'Unable to create deal room');
  }

  const participantValues: Array<typeof dealRoomParticipants.$inferInsert> = [
    {
      dealRoomId: createdRoom.id,
      userId: requesterId,
      role: 'buyer',
      pseudonym: 'Buyer',
    },
    {
      dealRoomId: createdRoom.id,
      userId: listing.sellerId,
      role: 'seller',
      pseudonym: 'Seller',
    },
  ];

  if (listing.agentId && listing.agentId !== requesterId && listing.agentId !== listing.sellerId) {
    participantValues.push({
      dealRoomId: createdRoom.id,
      userId: listing.agentId,
      role: 'legal_advisor',
      pseudonym: 'Legal Advisor',
    });
  }

  await db.insert(dealRoomParticipants).values(participantValues);
  await getOrCreateNda(createdRoom.id);
  await createDealRoomMessage({
    dealRoomId: createdRoom.id,
    senderId: null,
    senderPublicKey: null,
    type: 'system',
    contentPreview: `Interest expressed \u00b7 ${formatSystemTimestamp(new Date())}`,
  });

  return getDealRoomDetail(createdRoom.id, requesterId);
}

export async function getDealRoomParticipants(dealRoomId: string): Promise<DealRoomParticipant[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(dealRoomParticipants)
    .where(eq(dealRoomParticipants.dealRoomId, dealRoomId))
    .orderBy(asc(dealRoomParticipants.joinedAt));
  const userRows = await db.select().from(users).where(inArray(users.id, rows.map((row) => row.userId)));
  const userById = new Map(userRows.map((row) => [row.id, row]));

  return rows.map((row) =>
    serializeDealRoomParticipant(row, false, userById.get(row.userId)?.publicKey ?? null),
  );
}

export async function getDealRoomDetail(
  dealRoomId: string,
  userId: string,
  onlineUserIds: string[] = [],
): Promise<DealRoomDetail> {
  await requireDealRoomParticipant(dealRoomId, userId);
  const db = getDb();
  const room = await getRoomRow(dealRoomId);
  const listing = await getListingRow(room.listingId);
  const participantRows = await db
    .select()
    .from(dealRoomParticipants)
    .where(eq(dealRoomParticipants.dealRoomId, dealRoomId))
    .orderBy(asc(dealRoomParticipants.joinedAt));
  const userRows = await db
    .select()
    .from(users)
    .where(inArray(users.id, participantRows.map((row) => row.userId)));
  const messageRows = await db
    .select()
    .from(messages)
    .where(eq(messages.dealRoomId, dealRoomId))
    .orderBy(asc(messages.createdAt));
  const fileRows = await db
    .select()
    .from(dealRoomFiles)
    .where(eq(dealRoomFiles.dealRoomId, dealRoomId))
    .orderBy(desc(dealRoomFiles.createdAt));
  const [ndaRow] = await db.select().from(ndas).where(eq(ndas.dealRoomId, dealRoomId)).limit(1);
  const offerRows = await db
    .select()
    .from(offers)
    .where(eq(offers.dealRoomId, dealRoomId))
    .orderBy(asc(offers.createdAt));

  const pseudonymByUserId = new Map(participantRows.map((row) => [row.userId, row.pseudonym]));
  const userById = new Map(userRows.map((row) => [row.id, row]));
  const participants = participantRows.map((row) =>
    serializeDealRoomParticipant(
      row,
      onlineUserIds.includes(row.userId),
      userById.get(row.userId)?.publicKey ?? null,
    ),
  );
  const serializedFiles = fileRows.map((row) =>
    serializeDealRoomFile(row, pseudonymByUserId.get(row.uploadedBy)),
  );

  return serializeDealRoomDetail({
    room,
    listing,
    participants,
    messages: messageRows.map(serializeDealRoomMessage),
    files: serializedFiles,
    nda: ndaRow ? serializeNda(ndaRow) : null,
    offers: offerRows.map(serializeOffer),
  });
}

async function updateRoomActivity(
  dealRoomId: string,
  data: Partial<typeof dealRooms.$inferInsert>,
) {
  const db = getDb();
  await db
    .update(dealRooms)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(dealRooms.id, dealRoomId));
}

export async function createDealRoomMessage(input: {
  dealRoomId: string;
  senderId: string | null;
  senderPublicKey: string | null;
  type: DealRoomMessage['type'];
  ciphertext?: string | null;
  nonce?: string | null;
  contentPreview?: string | null;
  metadata?: Record<string, unknown>;
  expiresAt?: Date | null;
}): Promise<DealRoomMessage> {
  const db = getDb();
  const participantRows = await db
    .select()
    .from(dealRoomParticipants)
    .where(eq(dealRoomParticipants.dealRoomId, input.dealRoomId));
  const deliveredTo = participantRows
    .map((participant) => participant.userId)
    .filter((participantId) => participantId !== input.senderId);

  const [message] = await db
    .insert(messages)
    .values({
      dealRoomId: input.dealRoomId,
      senderId: input.senderId,
      senderPublicKey: input.senderPublicKey,
      type: input.type,
      ciphertext: input.ciphertext ?? null,
      nonce: input.nonce ?? null,
      contentPreview: input.contentPreview ?? null,
      metadata: input.metadata ?? {},
      deliveredTo,
      readBy: [],
      reactions: [],
      expiresAt: input.expiresAt ?? null,
    })
    .returning();

  if (!message) {
    throw new DealRoomError(500, 'MESSAGE_CREATE_FAILED', 'Unable to store deal room message');
  }

  await updateRoomActivity(input.dealRoomId, { lastMessageAt: message.createdAt });
  return serializeDealRoomMessage(message);
}

export async function markDealRoomMessageRead(messageId: string, userId: string): Promise<DealRoomMessage> {
  const db = getDb();
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);

  if (!message) {
    throw new DealRoomError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
  }

  await requireDealRoomParticipant(message.dealRoomId, userId);

  const existing = message.readBy ?? [];
  if (!existing.some((entry) => entry.userId === userId)) {
    existing.push({ userId, readAt: new Date().toISOString() });
  }

  const [updated] = await db
    .update(messages)
    .set({ readBy: existing })
    .where(eq(messages.id, messageId))
    .returning();

  if (!updated) {
    throw new DealRoomError(500, 'MESSAGE_READ_FAILED', 'Unable to update message read status');
  }

  return serializeDealRoomMessage(updated);
}

export async function addDealRoomMessageReaction(
  messageId: string,
  userId: string,
  input: AddMessageReactionInput,
): Promise<DealRoomMessage> {
  const db = getDb();
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);

  if (!message) {
    throw new DealRoomError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
  }

  await requireDealRoomParticipant(message.dealRoomId, userId);

  const nextReactions = (message.reactions ?? []).filter((reaction) => reaction.userId !== userId);
  nextReactions.push({
    emoji: input.emoji,
    userId,
    createdAt: new Date().toISOString(),
  });

  const [updated] = await db
    .update(messages)
    .set({ reactions: nextReactions })
    .where(eq(messages.id, messageId))
    .returning();

  if (!updated) {
    throw new DealRoomError(500, 'REACTION_UPDATE_FAILED', 'Unable to update message reaction');
  }

  return serializeDealRoomMessage(updated);
}

export async function setDealRoomMessageExpiry(
  messageId: string,
  userId: string,
  expiresInHours: 24 | 72 | 168 | null,
): Promise<DealRoomMessage> {
  const db = getDb();
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);

  if (!message) {
    throw new DealRoomError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
  }

  if (message.senderId !== userId) {
    throw new DealRoomError(403, 'MESSAGE_FORBIDDEN', 'Only the sender can update message expiry');
  }

  const expiresAt = expiresInHours === null ? null : new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
  const [updated] = await db
    .update(messages)
    .set({ expiresAt })
    .where(eq(messages.id, messageId))
    .returning();

  if (!updated) {
    throw new DealRoomError(500, 'MESSAGE_EXPIRY_FAILED', 'Unable to update message expiry');
  }

  return serializeDealRoomMessage(updated);
}

export async function createDealRoomFile(input: {
  dealRoomId: string;
  uploadedBy: string;
  payload: UploadDealRoomFileInput;
}): Promise<{ file: DealRoomFile; message: DealRoomMessage }> {
  await requireDealRoomParticipant(input.dealRoomId, input.uploadedBy);
  const db = getDb();

  const [file] = await db
    .insert(dealRoomFiles)
    .values({
      dealRoomId: input.dealRoomId,
      uploadedBy: input.uploadedBy,
      category: input.payload.category,
      fileNameEncrypted: input.payload.fileNameEncrypted,
      mimeType: input.payload.mimeType,
      s3Key: input.payload.s3Key,
      sizeBytes: input.payload.sizeBytes,
      nonce: input.payload.nonce,
      wrappedKeys: input.payload.wrappedKeys,
      encryptedBlobBase64: input.payload.encryptedBlobBase64 ?? null,
      expiresAt: input.payload.expiresAt ? new Date(input.payload.expiresAt) : null,
    })
    .returning();

  if (!file) {
    throw new DealRoomError(500, 'FILE_CREATE_FAILED', 'Unable to store encrypted file');
  }

  const message = await createDealRoomMessage({
    dealRoomId: input.dealRoomId,
    senderId: input.uploadedBy,
    senderPublicKey: null,
    type: 'file',
    contentPreview: 'Encrypted file shared',
    metadata: {
      fileId: file.id,
      category: file.category,
      sizeBytes: file.sizeBytes,
    },
  });

  const [linked] = await db
    .update(dealRoomFiles)
    .set({ messageId: message.id })
    .where(eq(dealRoomFiles.id, file.id))
    .returning();

  const [participant] = await db
    .select()
    .from(dealRoomParticipants)
    .where(and(eq(dealRoomParticipants.dealRoomId, input.dealRoomId), eq(dealRoomParticipants.userId, input.uploadedBy)))
    .limit(1);

  return {
    file: serializeDealRoomFile(linked ?? file, participant?.pseudonym),
    message,
  };
}

export async function incrementDealRoomFileDownloads(
  dealRoomId: string,
  fileId: string,
  userId: string,
): Promise<DealRoomFile> {
  await requireDealRoomParticipant(dealRoomId, userId);
  const db = getDb();
  const [file] = await db
    .select()
    .from(dealRoomFiles)
    .where(and(eq(dealRoomFiles.id, fileId), eq(dealRoomFiles.dealRoomId, dealRoomId)))
    .limit(1);

  if (!file) {
    throw new DealRoomError(404, 'FILE_NOT_FOUND', 'Deal room file not found');
  }

  const [updated] = await db
    .update(dealRoomFiles)
    .set({ downloads: file.downloads + 1 })
    .where(eq(dealRoomFiles.id, fileId))
    .returning();

  const [participant] = await db
    .select()
    .from(dealRoomParticipants)
    .where(and(eq(dealRoomParticipants.dealRoomId, dealRoomId), eq(dealRoomParticipants.userId, file.uploadedBy)))
    .limit(1);

  return serializeDealRoomFile(updated ?? file, participant?.pseudonym);
}

export async function createOfferThread(input: {
  dealRoomId: string;
  senderId: string;
  payload: CreateOfferInput;
}): Promise<{ offer: Offer; systemMessage: DealRoomMessage; stageChanged: DealRoomStatus }> {
  await requireDealRoomParticipant(input.dealRoomId, input.senderId);
  const db = getDb();
  const [offer] = await db
    .insert(offers)
    .values({
      dealRoomId: input.dealRoomId,
      parentOfferId: input.payload.parentOfferId ?? null,
      senderId: input.senderId,
      senderPublicKey: input.payload.senderPublicKey,
      amount: input.payload.amount.toFixed(2),
      currency: input.payload.currency,
      conditionsCiphertext: input.payload.conditionsCiphertext,
      conditionsNonce: input.payload.conditionsNonce,
      status: input.payload.parentOfferId ? 'countered' : 'submitted',
      expiresAt: input.payload.expiresAt ? new Date(input.payload.expiresAt) : null,
    })
    .returning();

  if (!offer) {
    throw new DealRoomError(500, 'OFFER_CREATE_FAILED', 'Unable to create offer');
  }

  await updateRoomActivity(input.dealRoomId, {
    status: 'offer_submitted',
    stageChangedAt: new Date(),
  });

  const systemMessage = await createDealRoomMessage({
    dealRoomId: input.dealRoomId,
    senderId: null,
    senderPublicKey: null,
    type: 'offer',
    contentPreview: `Offer submitted \u00b7 ${offer.currency} ${offer.amount}`,
    metadata: { offerId: offer.id, amount: offer.amount, currency: offer.currency },
  });

  return {
    offer: serializeOffer(offer),
    systemMessage,
    stageChanged: 'offer_submitted',
  };
}

async function getOrCreateNda(dealRoomId: string): Promise<NDA> {
  const db = getDb();
  const [existing] = await db.select().from(ndas).where(eq(ndas.dealRoomId, dealRoomId)).limit(1);
  if (existing) return serializeNda(existing);

  const participantRows = await db
    .select()
    .from(dealRoomParticipants)
    .where(eq(dealRoomParticipants.dealRoomId, dealRoomId))
    .orderBy(asc(dealRoomParticipants.joinedAt));

  const [created] = await db
    .insert(ndas)
    .values({
      dealRoomId,
      templateVersion: 'phase3-v1',
      parties: participantRows.map((participant) => ({
        participantId: participant.id,
        pseudonym: participant.pseudonym,
        role: participant.role,
        signedAt: null,
        signatureHash: null,
      })),
      signatureHashes: {},
      status: 'pending',
    })
    .returning();

  if (!created) {
    throw new DealRoomError(500, 'NDA_CREATE_FAILED', 'Unable to create NDA record');
  }

  return serializeNda(created);
}

async function generateNdaPdfBytes(nda: NDA): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawText('VAULT Mutual NDA', {
    x: 50,
    y: 780,
    size: 20,
    font: boldFont,
    color: rgb(0.08, 0.08, 0.08),
  });
  page.drawText(`Template version: ${nda.templateVersion}`, {
    x: 50,
    y: 750,
    size: 11,
    font,
  });
  page.drawText('Parties (pseudonymous until identity reveal):', {
    x: 50,
    y: 715,
    size: 12,
    font: boldFont,
  });

  let y = 690;
  for (const party of nda.parties) {
    page.drawText(
      `${party.pseudonym} (${party.role}) - ${party.signatureHash ? `Signed: ${party.signatureHash}` : 'Pending'}`,
      {
        x: 50,
        y,
        size: 10,
        font,
      },
    );
    y -= 18;
  }

  page.drawText(
    'This mock PDF is generated server-side to represent the executed NDA artifact for the deal room.',
    {
      x: 50,
      y: 120,
      size: 10,
      font,
      maxWidth: 500,
    },
  );

  return pdf.save();
}

export async function signDealRoomNda(input: {
  dealRoomId: string;
  userId: string;
  payload: SignNDAInput;
}): Promise<{
  nda: NDA;
  systemMessage: DealRoomMessage;
  stageChanged: DealRoomStatus | null;
}> {
  const db = getDb();
  const room = await getRoomRow(input.dealRoomId);
  const participant = await requireDealRoomParticipant(input.dealRoomId, input.userId);
  const participantRows = await db
    .select()
    .from(dealRoomParticipants)
    .where(eq(dealRoomParticipants.dealRoomId, input.dealRoomId))
    .orderBy(asc(dealRoomParticipants.joinedAt));
  const currentNda = await getOrCreateNda(input.dealRoomId);
  const signedAt = new Date();
  const signatureHash = createHash('sha256')
    .update(`${input.userId}:${participant.id}:${input.payload.signatureType}:${input.payload.signatureValue}:${signedAt.toISOString()}`)
    .digest('hex');

  const updatedParties = currentNda.parties.map((party) =>
    party.participantId === participant.id
      ? { ...party, signedAt: signedAt.toISOString(), signatureHash }
      : party,
  );

  const requiredParticipantIds = getRequiredNdaParticipantIds(participantRows);
  const fullySigned = requiredParticipantIds.every((participantId) =>
    updatedParties.some((party) => party.participantId === participantId && party.signatureHash),
  );
  const nextStatus = fullySigned ? 'signed' : 'partially_signed';
  const pdfS3Key = fullySigned
    ? `mock://deal-rooms/${input.dealRoomId}/ndas/${signedAt.getTime()}.pdf`
    : currentNda.pdfS3Key;

  const [updatedNdaRow] = await db
    .update(ndas)
    .set({
      parties: updatedParties,
      signatureHashes: {
        ...currentNda.signatureHashes,
        [participant.id]: signatureHash,
      },
      status: nextStatus,
      pdfS3Key,
      updatedAt: signedAt,
    })
    .where(eq(ndas.dealRoomId, input.dealRoomId))
    .returning();

  if (!updatedNdaRow) {
    throw new DealRoomError(500, 'NDA_SIGN_FAILED', 'Unable to update NDA state');
  }

  if (fullySigned) {
    await generateNdaPdfBytes(serializeNda(updatedNdaRow));
    await updateRoomActivity(input.dealRoomId, {
      status: 'nda_signed',
      ndaStatus: 'signed',
      fullAddressRevealed: true,
      commercialDataUnlocked: true,
      stageChangedAt: signedAt,
    });
  } else {
    await updateRoomActivity(input.dealRoomId, {
      ndaStatus: nextStatus,
    });
  }

  const messageText = fullySigned
    ? `NDA signed by both parties \u00b7 ${formatSystemTimestamp(signedAt)}`
    : `NDA signed by ${participant.pseudonym} \u00b7 ${formatSystemTimestamp(signedAt)}`;

  const systemMessage = await createDealRoomMessage({
    dealRoomId: input.dealRoomId,
    senderId: null,
    senderPublicKey: null,
    type: 'nda',
    contentPreview: messageText,
    metadata: { ndaId: updatedNdaRow.id, status: updatedNdaRow.status },
  });

  return {
    nda: serializeNda(updatedNdaRow),
    systemMessage,
    stageChanged: fullySigned ? 'nda_signed' : null,
  };
}

export async function getDealRoomAssistantSuggestion(
  dealRoomId: string,
  userId: string,
): Promise<DealRoomAssistantSuggestion> {
  await requireDealRoomParticipant(dealRoomId, userId);
  const db = getDb();
  const room = await getRoomRow(dealRoomId);
  const fileRows = await db
    .select()
    .from(dealRoomFiles)
    .where(eq(dealRoomFiles.dealRoomId, dealRoomId))
    .orderBy(desc(dealRoomFiles.createdAt));
  const [lastMessage] = await db
    .select()
    .from(messages)
    .where(eq(messages.dealRoomId, dealRoomId))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const context: DealRoomAssistantContext = {
    stage: room.status,
    docsUploaded: fileRows.map((file, index) => `${file.category}-${index + 1}`),
    daysActive: daysBetween(room.createdAt, new Date()),
    lastMessageDate: lastMessage?.createdAt.toISOString() ?? null,
  };

  return aiService.getDealRoomAssistantSuggestion(context);
}

export async function getDealRoomFileForUser(
  dealRoomId: string,
  fileId: string,
  userId: string,
): Promise<DealRoomFile> {
  await requireDealRoomParticipant(dealRoomId, userId);
  const db = getDb();
  const [file] = await db
    .select()
    .from(dealRoomFiles)
    .where(and(eq(dealRoomFiles.id, fileId), eq(dealRoomFiles.dealRoomId, dealRoomId)))
    .limit(1);

  if (!file) {
    throw new DealRoomError(404, 'FILE_NOT_FOUND', 'Deal room file not found');
  }

  const [participant] = await db
    .select()
    .from(dealRoomParticipants)
    .where(and(eq(dealRoomParticipants.dealRoomId, dealRoomId), eq(dealRoomParticipants.userId, file.uploadedBy)))
    .limit(1);

  return serializeDealRoomFile(file, participant?.pseudonym);
}

export async function touchDealRoomParticipant(
  dealRoomId: string,
  userId: string,
): Promise<void> {
  await requireDealRoomParticipant(dealRoomId, userId);
  const db = getDb();
  await db
    .update(dealRoomParticipants)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(dealRoomParticipants.dealRoomId, dealRoomId), eq(dealRoomParticipants.userId, userId)));
}

export async function listParticipantRows(dealRoomId: string) {
  const db = getDb();
  return db
    .select()
    .from(dealRoomParticipants)
    .where(eq(dealRoomParticipants.dealRoomId, dealRoomId))
    .orderBy(asc(dealRoomParticipants.joinedAt));
}

export async function getParticipantForUserInRoom(dealRoomId: string, userId: string) {
  const db = getDb();
  const [participant] = await db
    .select()
    .from(dealRoomParticipants)
    .where(and(eq(dealRoomParticipants.dealRoomId, dealRoomId), eq(dealRoomParticipants.userId, userId)))
    .limit(1);

  return participant ?? null;
}
