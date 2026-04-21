'use client';

import Link from 'next/link';
import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  Bot,
  Calendar,
  Check,
  CheckCheck,
  Clock3,
  Download,
  Eye,
  FileLock2,
  Gavel,
  Handshake,
  Landmark,
  LockKeyhole,
  Mic,
  Paperclip,
  Phone,
  Send,
  ShieldCheck,
  Sparkles,
  UnlockKeyhole,
  Video,
} from 'lucide-react';
import { VaultApiClient } from '@vault/api-client';
import { encodeBase64 } from '@vault/crypto';
import type {
  DealRoomDetail,
  DealRoomDocumentAnalysis,
  DealRoomFile,
  DealRoomMessage,
  DealRoomParticipant,
  ICEServer,
  MeetingRequest,
  MeetingType,
  Offer,
  ReactionEmoji,
} from '@vault/types';
import { Badge, Button, Input, Label } from '@vault/ui';
import { decryptDealRoomEnvelope, decryptDealRoomFile, encryptDealRoomEnvelope, encryptDealRoomFile } from '@/lib/deal-room-crypto';
import { useAuth } from '@/components/providers/auth-provider';
import { CallOverlay, type CallState } from './call-overlay';
import {
  MeetingAvailabilityDrawer,
  MeetingSchedulerDrawer,
} from './meeting-scheduler-drawer';
import { DealTeamManager } from './deal-team-manager';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const SOCKET_BASE_URL = API_BASE_URL.replace(/\/api\/v1$/, '');
const STAGE_STEPS = [
  'interest_expressed',
  'pending_nda',
  'nda_signed',
  'due_diligence',
  'offer_submitted',
  'offer_accepted',
  'closed',
] as const;
const STAGE_LABELS: Record<(typeof STAGE_STEPS)[number], string> = {
  interest_expressed: 'Interest expressed',
  pending_nda: 'NDA pending',
  nda_signed: 'NDA signed',
  due_diligence: 'Due diligence',
  offer_submitted: 'Offer submitted',
  offer_accepted: 'Offer accepted',
  closed: 'Closed',
};
const FILE_CATEGORY_LABELS: Record<DealRoomFile['category'], string> = {
  asset_docs: 'Asset Docs',
  legal: 'Legal',
  financial: 'Financial',
  offers: 'Offers',
  other: 'Other',
};
const REACTION_LABELS: Record<ReactionEmoji, string> = {
  thumbs_up: '👍',
  heart: '❤️',
  fire: '🔥',
  eyes: '👀',
  check: '✅',
  handshake: '🤝',
};

function formatDateTime(value?: string | null) {
  if (!value) return 'Now';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatRelativeCountdown(value?: string | null) {
  if (!value) return 'Never';
  const remaining = new Date(value).getTime() - Date.now();
  if (remaining <= 0) return 'Expired';
  const totalHours = Math.floor(remaining / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCurrency(amount: string, currency: string) {
  const numeric = Number(amount);
  if (Number.isNaN(numeric)) return `${currency} ${amount}`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(numeric);
}

function dedupeMessages(messages: DealRoomMessage[]) {
  const byId = new Map(messages.map((message) => [message.id, message]));
  return Array.from(byId.values()).sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

function getReceiptState(message: DealRoomMessage, currentUserId: string, participantCount: number) {
  if (message.senderId !== currentUserId) return 'incoming' as const;
  const otherParticipantCount = Math.max(0, participantCount - 1);
  const readCount = message.readBy.filter((entry) => entry.userId !== currentUserId).length;
  if (otherParticipantCount > 0 && readCount >= otherParticipantCount) return 'read' as const;
  if ((message.deliveredTo?.length ?? 0) > 0) return 'delivered' as const;
  return 'sent' as const;
}

function isRoomParticipantCurrentUser(
  room: DealRoomDetail | null,
  userId: string | undefined,
): DealRoomParticipant | null {
  if (!room || !userId) return null;
  return room.participants.find((participant) => participant.userId === userId) ?? null;
}

function getCounterpartyParticipants(room: DealRoomDetail | null, userId: string | undefined) {
  if (!room || !userId) return [];
  return room.participants.filter((participant) => participant.userId !== userId);
}

async function decryptFileName(
  file: DealRoomFile,
  senderPublicKey: string,
  recipientPrivateKey: string,
  userId: string,
) {
  try {
    const payload = JSON.parse(file.fileNameEncrypted) as { ciphertext: string; nonce: string };
    return await decryptDealRoomEnvelope({
      ciphertext: payload.ciphertext,
      nonce: payload.nonce,
      senderPublicKey,
      recipientPrivateKey,
      userId,
    });
  } catch {
    return 'Encrypted file';
  }
}

export function DealRoomClient({ dealRoomId }: { dealRoomId: string }) {
  const {
    token,
    user,
    privateKey,
    privateKeyStatus,
    unlockVaultKey,
    loading: authLoading,
  } = useAuth();
  const [room, setRoom] = useState<DealRoomDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [assistantSuggestion, setAssistantSuggestion] = useState<string | null>(null);
  const [messageBodies, setMessageBodies] = useState<Record<string, string>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [offerBodies, setOfferBodies] = useState<Record<string, string>>({});
  const [fileAnalyses, setFileAnalyses] = useState<Record<string, DealRoomDocumentAnalysis>>({});
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [ndaModalOpen, setNdaModalOpen] = useState(false);
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [offerAmount, setOfferAmount] = useState('5000000');
  const [offerCurrency, setOfferCurrency] = useState('USD');
  const [offerConditions, setOfferConditions] = useState('Subject to title deed review and data room confirmation.');
  const [offerExpiry, setOfferExpiry] = useState('');
  const [signatureMode, setSignatureMode] = useState<'typed' | 'drawn'>('typed');
  const [signatureName, setSignatureName] = useState(user?.displayName ?? '');
  const [viewInlineByFile, setViewInlineByFile] = useState<Record<string, boolean>>({});
  const [uploadingFileId, setUploadingFileId] = useState<string | null>(null);
  const [activeContextMessageId, setActiveContextMessageId] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>({ phase: 'idle' });
  const [iceServers, setIceServers] = useState<ICEServer[]>([]);
  const [meetingSchedulerOpen, setMeetingSchedulerOpen] = useState(false);
  const [meetingRequests, setMeetingRequests] = useState<MeetingRequest[]>([]);
  const [respondingRequest, setRespondingRequest] = useState<MeetingRequest | null>(null);
  const [meetingLoading, setMeetingLoading] = useState(false);
  const [callLogId, setCallLogId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  const api = useMemo(
    () =>
      new VaultApiClient({
        baseUrl: API_BASE_URL,
        getToken: () => token,
      }),
    [token],
  );
  const currentParticipant = isRoomParticipantCurrentUser(room, user?.id);
  const participantByUserId = useMemo(
    () => new Map(room?.participants.map((participant) => [participant.userId, participant]) ?? []),
    [room],
  );
  const fileById = useMemo(
    () => new Map(room?.files.map((file) => [file.id, file]) ?? []),
    [room],
  );
  const typingLabels = useMemo(
    () =>
      Object.entries(typingUsers)
        .filter(([, isTyping]) => isTyping)
        .map(([userId]) => participantByUserId.get(userId)?.pseudonym ?? 'Participant')
        .filter((label) => label !== currentParticipant?.pseudonym),
    [currentParticipant?.pseudonym, participantByUserId, typingUsers],
  );

  async function refreshRoom() {
    if (!token) return;

    setLoading(true);
    const response = await api.getDealRoom(dealRoomId);
    if (!response.success || !response.data) {
      setError(response.error?.message ?? 'Unable to load the encrypted deal room.');
      setLoading(false);
      return;
    }

    setError(null);
    setRoom(response.data);
    setLoading(false);
  }

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    void refreshRoom();
    void api.getICEServers().then((res) => {
      if (res.success && res.data) setIceServers(res.data);
    });
    void api.getDealRoomMeetings(dealRoomId).then((res) => {
      if (res.success && res.data) setMeetingRequests(res.data);
    });
  }, [api, dealRoomId, token]);

  async function startCall(callType: 'audio' | 'video') {
    if (!room || !user) return;
    const counterparties = getCounterpartyParticipants(room, user.id);
    if (counterparties.length === 0) return;
    const target = counterparties[0];
    if (!target) return;

    const allParticipantIds = room.participants.map((p) => p.userId);
    const res = await api.startCall(room.id, callType, allParticipantIds);
    if (res.success && res.data) setCallLogId(res.data.id);

    setCallState({
      phase: 'outgoing',
      callType,
      dealRoomId: room.id,
      toUserId: target.userId,
      toPseudonym: target.pseudonym,
      callLogId: res.data?.id,
    });

    socketRef.current?.emit('call:initiate', {
      dealRoomId: room.id,
      callType,
      toUserId: target.userId,
    });
  }

  async function scheduleMeeting(
    meetingType: MeetingType,
    durationMinutes: number,
    timezone: string,
    slots: string[],
  ) {
    if (!room) return;
    setMeetingLoading(true);
    try {
      const reqRes = await api.createMeetingRequest(room.id, { meetingType, durationMinutes, timezone });
      if (!reqRes.success || !reqRes.data) return;
      const availRes = await api.submitMeetingAvailability(reqRes.data.id, { slots });
      if (availRes.success) {
        setMeetingRequests((prev) => [reqRes.data!, ...prev]);
        setMeetingSchedulerOpen(false);
      }
    } finally {
      setMeetingLoading(false);
    }
  }

  async function submitAvailability(slots: string[]) {
    if (!respondingRequest) return;
    setMeetingLoading(true);
    try {
      await api.submitMeetingAvailability(respondingRequest.id, { slots });
      setRespondingRequest(null);
      void api.getDealRoomMeetings(dealRoomId).then((res) => {
        if (res.success && res.data) setMeetingRequests(res.data);
      });
    } finally {
      setMeetingLoading(false);
    }
  }

  async function hydrateDecryptedData() {
    if (!room || !user?.id || !privateKey) {
      startTransition(() => {
        setMessageBodies({});
        setFileNames({});
        setOfferBodies({});
      });
      return;
    }

    const nextBodies: Record<string, string> = {};
    const nextFileNames: Record<string, string> = {};
    const nextOfferBodies: Record<string, string> = {};

    await Promise.all(
      room.messages.map(async (message) => {
        if (message.contentPreview) {
          nextBodies[message.id] = message.contentPreview;
          return;
        }

        if (!message.ciphertext || !message.nonce || !message.senderPublicKey) {
          nextBodies[message.id] = 'Encrypted message';
          return;
        }

        try {
          nextBodies[message.id] = await decryptDealRoomEnvelope({
            ciphertext: message.ciphertext,
            nonce: message.nonce,
            senderPublicKey: message.senderPublicKey,
            recipientPrivateKey: privateKey,
            userId: user.id,
          });
        } catch {
          nextBodies[message.id] = 'Encrypted message';
        }
      }),
    );

    await Promise.all(
      room.files.map(async (file) => {
        const senderPublicKey = participantByUserId.get(file.uploadedBy)?.publicKey;
        if (!senderPublicKey) {
          nextFileNames[file.id] = 'Encrypted file';
          return;
        }

        nextFileNames[file.id] = await decryptFileName(file, senderPublicKey, privateKey, user.id);
      }),
    );

    await Promise.all(
      room.offers.map(async (offer) => {
        try {
          nextOfferBodies[offer.id] = await decryptDealRoomEnvelope({
            ciphertext: offer.conditionsCiphertext,
            nonce: offer.conditionsNonce,
            senderPublicKey: offer.senderPublicKey,
            recipientPrivateKey: privateKey,
            userId: user.id,
          });
        } catch {
          nextOfferBodies[offer.id] = 'Encrypted offer conditions';
        }
      }),
    );

    startTransition(() => {
      setMessageBodies(nextBodies);
      setFileNames(nextFileNames);
      setOfferBodies(nextOfferBodies);
    });
  }

  useEffect(() => {
    void hydrateDecryptedData();
  }, [participantByUserId, privateKey, room, user?.id]);

  function handleNewMessage(message: DealRoomMessage) {
    setRoom((current) =>
      current
        ? {
            ...current,
            messages: dedupeMessages([...current.messages, message]),
            lastMessageAt: message.createdAt,
          }
        : current,
    );
  }

  function handleReadReceipt(payload: { messageId: string; userId: string; readAt: string }) {
    setRoom((current) =>
      current
        ? {
            ...current,
            messages: current.messages.map((message) =>
              message.id === payload.messageId
                ? {
                    ...message,
                    readBy: [
                      ...message.readBy.filter((entry) => entry.userId !== payload.userId),
                      { userId: payload.userId, readAt: payload.readAt },
                    ],
                  }
                : message,
            ),
          }
        : current,
    );
  }

  function handlePresenceUpdate(payload: {
    participants: Array<{ id: string; pseudonym: string; online: boolean }>;
  }) {
    setRoom((current) =>
      current
        ? {
            ...current,
            participants: current.participants.map((participant) => ({
              ...participant,
              online:
                payload.participants.find((entry) => entry.id === participant.userId)?.online ??
                participant.online,
            })),
          }
        : current,
    );
  }

  function handleTypingUpdate(payload: { userId: string; isTyping: boolean }) {
    setTypingUsers((current) => ({
      ...current,
      [payload.userId]: payload.isTyping,
    }));
  }

  function handleStageChange(payload: {
    newStatus: DealRoomDetail['status'];
    systemMessage: string;
  }) {
    setRoom((current) =>
      current
        ? {
            ...current,
            status: payload.newStatus,
            ndaStatus: payload.newStatus === 'nda_signed' ? 'signed' : current.ndaStatus,
            fullAddressRevealed: payload.newStatus === 'nda_signed' ? true : current.fullAddressRevealed,
            commercialDataUnlocked:
              payload.newStatus === 'nda_signed' ? true : current.commercialDataUnlocked,
          }
        : current,
    );
    setNotice(payload.systemMessage);
  }

  useEffect(() => {
    if (!token || !room) return;

    const socket = io(SOCKET_BASE_URL, {
      auth: { token },
      transports: ['websocket'],
    });

    socketRef.current = socket;
    socket.on('connect', () => {
      socket.emit('room:join', { dealRoomId: room.id });
    });
    socket.on('message:new', handleNewMessage);
    socket.on('message:read', handleReadReceipt);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('typing:update', handleTypingUpdate);
    socket.on('room:stage_change', handleStageChange);

    socket.on('call:incoming', (payload: {
      callType: 'audio' | 'video';
      dealRoomId: string;
      fromUserId: string;
      fromPseudonym: string;
    }) => {
      setCallState({
        phase: 'incoming',
        callType: payload.callType,
        dealRoomId: payload.dealRoomId,
        fromUserId: payload.fromUserId,
        fromPseudonym: payload.fromPseudonym,
      });
    });

    const interval = window.setInterval(() => {
      socket.emit('presence:ping');
    }, 30_000);

    return () => {
      window.clearInterval(interval);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [room?.id, token]);

  useEffect(() => {
    if (!room || !user?.id || !socketRef.current) return;

    for (const message of room.messages) {
      if (message.senderId === user.id) continue;
      if (message.readBy.some((entry) => entry.userId === user.id)) continue;
      socketRef.current.emit('message:read', { messageId: message.id });
    }
  }, [room, user?.id]);

  async function sendMessage() {
    if (!room || !socketRef.current || !currentParticipant?.publicKey || !privateKey) return;
    const trimmed = messageDraft.trim();
    if (!trimmed) return;

    const participantsWithKeys = room.participants.filter((participant) => participant.publicKey);
    const encrypted = await encryptDealRoomEnvelope({
      plaintext: trimmed,
      senderPrivateKey: privateKey,
      participants: participantsWithKeys,
    });

    socketRef.current.emit('message:send', {
      dealRoomId: room.id,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      senderPublicKey: currentParticipant.publicKey,
      type: 'text',
    });

    setMessageDraft('');
    socketRef.current.emit('typing:stop', { dealRoomId: room.id });
  }

  async function handleUnlockPrivateKey() {
    if (!unlockPassword) return;
    const unlocked = await unlockVaultKey(unlockPassword);
    if (!unlocked) {
      setNotice('Private key unlock failed. Check the password and try again.');
      return;
    }

    setUnlockPassword('');
    setNotice('Private key unlocked in memory for this session.');
  }

  function drawSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (!drawingRef.current) {
      context.beginPath();
      context.moveTo(x, y);
      drawingRef.current = true;
    } else {
      context.lineTo(x, y);
      context.strokeStyle = '#d8b46b';
      context.lineWidth = 2;
      context.lineCap = 'round';
      context.stroke();
    }
  }

  function endDrawing() {
    drawingRef.current = false;
  }

  function clearSignatureCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function submitNdaSignature() {
    if (!room) return;
    const signatureValue =
      signatureMode === 'typed'
        ? signatureName.trim()
        : canvasRef.current?.toDataURL('image/png') ?? '';

    if (!signatureValue) {
      setNotice('Provide a typed or drawn signature before submitting the NDA.');
      return;
    }

    const response = await api.signDealRoomNda(room.id, {
      signatureType: signatureMode,
      signatureValue,
    });

    if (!response.success) {
      setNotice(response.error?.message ?? 'Unable to sign the NDA right now.');
      return;
    }

    setNdaModalOpen(false);
    await refreshRoom();
  }

  async function submitOffer() {
    if (!room || !currentParticipant?.publicKey || !privateKey) return;
    const amount = Number(offerAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      setNotice('Enter a valid offer amount.');
      return;
    }

    const encrypted = await encryptDealRoomEnvelope({
      plaintext: offerConditions,
      senderPrivateKey: privateKey,
      participants: room.participants.filter((participant) => participant.publicKey),
    });

    const response = await api.createDealRoomOffer(room.id, {
      amount,
      currency: offerCurrency,
      conditionsCiphertext: encrypted.ciphertext,
      conditionsNonce: encrypted.nonce,
      senderPublicKey: currentParticipant.publicKey,
      expiresAt: offerExpiry ? new Date(offerExpiry).toISOString() : null,
    });

    if (!response.success || !response.data) {
      setNotice(response.error?.message ?? 'Offer submission failed.');
      return;
    }

    const createdOffer = response.data;

    setRoom((current) =>
      current
        ? {
            ...current,
            offers: [...current.offers, createdOffer],
            status: 'offer_submitted',
          }
        : current,
    );
    setOfferModalOpen(false);
    await refreshRoom();
  }

  async function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    if (!room || !privateKey || !currentParticipant?.publicKey) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingFileId(file.name);
    const encryptedFile = await encryptDealRoomFile({
      file,
      senderPrivateKey: privateKey,
      participants: room.participants.filter((participant) => participant.publicKey),
    });
    const encryptedNamePayload = await encryptDealRoomEnvelope({
      plaintext: file.name,
      senderPrivateKey: privateKey,
      participants: room.participants.filter((participant) => participant.publicKey),
    });

    socketRef.current?.emit('file:upload', {
      dealRoomId: room.id,
      fileNameEncrypted: JSON.stringify(encryptedNamePayload),
      s3Key: `mock-r2/${room.id}/${Date.now()}-${file.name.replaceAll(/\s+/g, '-').toLowerCase()}`,
      wrappedKeys: encryptedFile.wrappedKeys,
      sizeBytes: file.size,
      expiresAt: null,
      category: 'other',
      mimeType: file.type || 'application/octet-stream',
      nonce: encryptedFile.nonce,
      encryptedBlobBase64: encryptedFile.encryptedBlobBase64,
    });

    setUploadingFileId(null);
    event.target.value = '';
  }

  async function downloadFile(file: DealRoomFile, inline: boolean) {
    if (!room || !privateKey || !user?.id) return;
    const response = await api.getDealRoomFile(room.id, file.id);
    if (!response.success || !response.data) {
      setNotice(response.error?.message ?? 'Unable to retrieve the encrypted file.');
      return;
    }

    const senderPublicKey = participantByUserId.get(file.uploadedBy)?.publicKey;
    if (!senderPublicKey || !response.data.encryptedBlobBase64) {
      setNotice('This file cannot be decrypted in the current session.');
      return;
    }

    const decryptedBuffer = await decryptDealRoomFile({
      encryptedBlobBase64: response.data.encryptedBlobBase64,
      nonce: response.data.nonce,
      wrappedKeys: response.data.wrappedKeys,
      senderPublicKey,
      recipientPrivateKey: privateKey,
      userId: user.id,
    });
    const decryptedName = fileNames[file.id] ?? 'vault-document';
    const watermarkText = response.data.watermarkText;
    const blob =
      response.data.mimeType.startsWith('text/')
        ? new Blob(
            [new TextDecoder().decode(decryptedBuffer), `\n\n${watermarkText}`],
            { type: response.data.mimeType },
          )
        : new Blob([decryptedBuffer], { type: response.data.mimeType });
    const objectUrl = URL.createObjectURL(blob);

    if (inline) {
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
    } else {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = decryptedName;
      link.click();
    }

    setNotice(watermarkText);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  async function analyseFile(file: DealRoomFile) {
    if (!room || !privateKey || !user?.id || !file.encryptedBlobBase64) return;

    const senderPublicKey = participantByUserId.get(file.uploadedBy)?.publicKey;
    if (!senderPublicKey) {
      setNotice('The uploader public key is missing for this document.');
      return;
    }

    const decryptedBuffer = await decryptDealRoomFile({
      encryptedBlobBase64: file.encryptedBlobBase64,
      nonce: file.nonce,
      wrappedKeys: file.wrappedKeys,
      senderPublicKey,
      recipientPrivateKey: privateKey,
      userId: user.id,
    });

    const response = await api.analyseDealRoomFile(room.id, file.id, {
      base64Content: encodeBase64(decryptedBuffer),
      fileType: file.mimeType,
    });

    if (!response.success || !response.data) {
      setNotice(response.error?.message ?? 'AI document analysis failed.');
      return;
    }

    setFileAnalyses((current) => ({ ...current, [file.id]: response.data! }));
  }

  async function askAssistant() {
    if (!room) return;
    const response = await api.askDealRoomAssistant(room.id);
    if (!response.success || !response.data) {
      setNotice(response.error?.message ?? 'VAULT AI is unavailable right now.');
      return;
    }

    setAssistantSuggestion(response.data.message);
  }

  async function reactToMessage(messageId: string, emoji: ReactionEmoji) {
    if (!room) return;
    const response = await api.reactToDealRoomMessage(room.id, messageId, { emoji });
    if (!response.success || !response.data) return;
    setRoom((current) =>
      current
        ? {
            ...current,
            messages: current.messages.map((message) =>
              message.id === response.data!.id ? response.data! : message,
            ),
          }
        : current,
    );
  }

  async function updateMessageExpiry(messageId: string, expiresInHours: 24 | 72 | 168 | null) {
    if (!room) return;
    const response = await api.setDealRoomMessageExpiry(room.id, messageId, { expiresInHours });
    if (!response.success || !response.data) return;
    setRoom((current) =>
      current
        ? {
            ...current,
            messages: current.messages.map((message) =>
              message.id === response.data!.id ? response.data! : message,
            ),
          }
        : current,
    );
    setActiveContextMessageId(null);
  }

  if (authLoading || loading) {
    return <main className="page-wrap section-space text-stone-300">Opening encrypted deal room...</main>;
  }

  if (!token || !user) {
    return (
      <main className="page-wrap section-space">
        <div className="cinematic-panel rounded-[2rem] p-8">
          <h1 className="text-4xl text-stone-50">Sign in to access encrypted deal rooms</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-300">
            Phase 3 uses your account session and private key to decrypt room activity locally.
          </p>
          <div className="mt-6">
            <Button asChild variant="gold">
              <Link href="/auth/signin">Sign in</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (error || !room) {
    return (
      <main className="page-wrap section-space">
        <div className="cinematic-panel rounded-[2rem] p-8">
          <h1 className="text-4xl text-stone-50">Deal room unavailable</h1>
          <p className="mt-4 text-sm text-stone-300">{error ?? 'This room could not be loaded.'}</p>
        </div>
      </main>
    );
  }

  if (user.hasVaultKeys && privateKeyStatus !== 'unlocked') {
    return (
      <main className="page-wrap section-space">
        <div className="mx-auto max-w-2xl cinematic-panel rounded-[2rem] p-8">
          <div className="flex items-center gap-3 text-amber-200">
            <UnlockKeyhole className="h-6 w-6" />
            <p className="text-xs uppercase tracking-[0.26em]">Unlock Required</p>
          </div>
          <h1 className="mt-4 text-4xl text-stone-50">Unlock your private key to enter this room</h1>
          <p className="mt-4 text-sm leading-7 text-stone-300">
            VAULT keeps the decrypted key in memory only for the current session so chat, offers, and files stay end-to-end encrypted.
          </p>
          <div className="mt-6 grid gap-2">
            <Label htmlFor="unlock-password">Private key password</Label>
            <Input
              id="unlock-password"
              type="password"
              value={unlockPassword}
              onChange={(event) => setUnlockPassword(event.target.value)}
              placeholder="Enter the password you used when generating keys"
            />
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="gold" onClick={handleUnlockPrivateKey} disabled={privateKeyStatus === 'unlocking'}>
              {privateKeyStatus === 'unlocking' ? 'Unlocking...' : 'Unlock room key'}
            </Button>
            <Button asChild variant="outline">
              <Link href="/profile">Manage encryption keys</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (!user.hasVaultKeys) {
    return (
      <main className="page-wrap section-space">
        <div className="mx-auto max-w-2xl cinematic-panel rounded-[2rem] p-8">
          <div className="flex items-center gap-3 text-amber-200">
            <LockKeyhole className="h-6 w-6" />
            <p className="text-xs uppercase tracking-[0.26em]">Key Setup</p>
          </div>
          <h1 className="mt-4 text-4xl text-stone-50">Generate your VAULT crypto keys first</h1>
          <p className="mt-4 text-sm leading-7 text-stone-300">
            Deal-room chat, offers, and files require a public/private keypair before the client can encrypt and decrypt data locally.
          </p>
          <div className="mt-6">
            <Button asChild variant="gold">
              <Link href="/profile">Open profile security settings</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-wrap section-space">
      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="space-y-6">
          <section className="cinematic-panel rounded-[2rem] p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Deal timeline</p>
            <div className="mt-5 grid gap-4">
              {STAGE_STEPS.map((step, index) => {
                const currentIndex = STAGE_STEPS.indexOf(room.status);
                const state =
                  index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'pending';
                return (
                  <div key={step} className="flex items-center gap-3">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] ${
                        state === 'complete'
                          ? 'border-emerald-300/60 bg-emerald-400/15 text-emerald-200'
                          : state === 'current'
                            ? 'border-amber-300/60 bg-amber-400/15 text-amber-200'
                            : 'border-white/12 bg-white/4 text-stone-500'
                      }`}
                    >
                      {state === 'complete' ? '●' : state === 'current' ? '●' : '○'}
                    </span>
                    <div>
                      <p className="text-sm text-stone-100">{STAGE_LABELS[step]}</p>
                      <p className="text-xs uppercase tracking-[0.18em] text-stone-500">{state}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="cinematic-panel rounded-[2rem] p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Participants</p>
            <div className="mt-5 grid gap-3">
              {room.participants.map((participant) => (
                <div
                  key={participant.id}
                  className="flex items-center justify-between rounded-[1.2rem] border border-white/8 bg-white/3 px-4 py-3"
                >
                  <div>
                    <p className="text-sm text-stone-100">{participant.pseudonym}</p>
                    <p className="text-xs uppercase tracking-[0.18em] text-stone-500">
                      {participant.identityRevealed ? 'Identity revealed' : 'Pseudonymous'}
                    </p>
                  </div>
                  <span className={`h-2.5 w-2.5 rounded-full ${participant.online ? 'bg-emerald-300' : 'bg-stone-600'}`} />
                </div>
              ))}
            </div>
          </section>

          <section className="cinematic-panel rounded-[2rem] p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Asset summary</p>
            <h2 className="mt-4 text-2xl text-stone-50">{room.listing.title}</h2>
            <div className="mt-4 grid gap-3 text-sm text-stone-300">
              <div className="rounded-[1.2rem] border border-white/8 bg-white/3 px-4 py-3">
                {room.fullAddressRevealed
                  ? `${room.listing.district ?? 'Private district'}, ${room.listing.city}, ${room.listing.country}`
                  : 'Full address hidden until NDA is fully signed'}
              </div>
              <div className="rounded-[1.2rem] border border-white/8 bg-white/3 px-4 py-3">
                {room.commercialDataUnlocked && room.listing.commercialData
                  ? `Occupancy ${room.listing.commercialData.occupancyRate ?? 'n/a'}% · NOI ${room.listing.commercialData.noi ?? 'n/a'}`
                  : 'Commercial performance unlocks after NDA signature'}
              </div>
            </div>
          </section>
        </aside>

        <section className="cinematic-panel rounded-[2rem] p-0 overflow-hidden">
          <header className="border-b border-white/8 bg-white/[0.03] px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl text-stone-50">{room.listing.title}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-stone-300">
                  <span className="pill">
                    <LockKeyhole className="h-4 w-4 text-amber-200" />
                    End-to-end encrypted · Powered by VAULT Crypto
                  </span>
                  <Badge>{STAGE_LABELS[room.status]}</Badge>
                </div>
              </div>
              <Button variant="outline" onClick={askAssistant}>
                <Bot className="mr-2 h-4 w-4" />
                Ask AI
              </Button>
            </div>
            {assistantSuggestion ? (
              <div className="mt-4 rounded-[1.2rem] border border-amber-300/15 bg-amber-400/8 px-4 py-3 text-sm text-amber-50">
                {assistantSuggestion}
              </div>
            ) : null}
          </header>

          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="border-r border-white/8">
              {room.status === 'pending_nda' ? (
                <div className="border-b border-white/8 bg-amber-400/8 px-6 py-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-amber-100/70">NDA Flow</p>
                      <h2 className="mt-2 text-xl text-stone-50">Sign NDA to unlock full asset details</h2>
                      <p className="mt-2 text-sm text-stone-300">
                        Parties are shown as pseudonyms until both sides sign.
                      </p>
                    </div>
                    <Button variant="gold" onClick={() => setNdaModalOpen(true)}>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Sign NDA
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="max-h-[720px] overflow-y-auto px-6 py-6">
                <div className="grid gap-4">
                  {room.messages.map((message) => {
                    const isOwn = message.senderId === user.id;
                    const file = typeof message.metadata.fileId === 'string' ? fileById.get(message.metadata.fileId) : null;
                    const sender = message.senderId ? participantByUserId.get(message.senderId) : null;
                    const receiptState = getReceiptState(message, user.id, room.participants.length);
                    const showContext = activeContextMessageId === message.id && message.senderId === user.id;

                    if (message.type === 'system' || message.senderId === null) {
                      return (
                        <div key={message.id} className="text-center text-xs uppercase tracking-[0.2em] text-stone-500">
                          {messageBodies[message.id] ?? message.contentPreview ?? 'System message'}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={message.id}
                        className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setActiveContextMessageId(showContext ? null : message.id);
                        }}
                      >
                        <div
                          className={`max-w-[78%] rounded-[1.6rem] px-4 py-3 shadow-lg ${
                            isOwn
                              ? 'bg-amber-400 text-stone-950'
                              : 'bg-white/8 text-stone-100'
                          }`}
                        >
                          <div className="mb-2 flex items-center justify-between gap-4 text-[11px] uppercase tracking-[0.18em]">
                            <span className={isOwn ? 'text-stone-900/65' : 'text-stone-400'}>
                              {sender?.pseudonym ?? 'Participant'}
                            </span>
                            <span className={isOwn ? 'text-stone-900/65' : 'text-stone-500'}>
                              {formatDateTime(message.createdAt)}
                            </span>
                          </div>
                          <div className="space-y-3">
                            {file ? (
                              <div className={`rounded-[1.25rem] border px-4 py-3 ${isOwn ? 'border-stone-900/10 bg-white/25' : 'border-white/10 bg-white/5'}`}>
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-start gap-3">
                                    <FileLock2 className={`mt-0.5 h-5 w-5 ${isOwn ? 'text-stone-900/70' : 'text-amber-200'}`} />
                                    <div>
                                      <p className="text-sm font-medium">{fileNames[file.id] ?? 'Encrypted file'}</p>
                                      <p className={`mt-1 text-xs ${isOwn ? 'text-stone-900/70' : 'text-stone-400'}`}>
                                        {formatBytes(file.sizeBytes)} · {FILE_CATEGORY_LABELS[file.category]}
                                      </p>
                                    </div>
                                  </div>
                                  <Button
                                    variant={isOwn ? 'secondary' : 'outline'}
                                    size="sm"
                                    onClick={() => void downloadFile(file, false)}
                                  >
                                    <Download className="mr-2 h-4 w-4" />
                                    Download
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm leading-7">{messageBodies[message.id] ?? 'Encrypted message'}</p>
                            )}

                            {message.reactions.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {message.reactions.map((reaction) => (
                                  <span
                                    key={`${reaction.userId}-${reaction.emoji}`}
                                    className={`rounded-full border px-2 py-1 text-xs ${isOwn ? 'border-stone-900/10 bg-white/25' : 'border-white/10 bg-white/5'}`}
                                  >
                                    {REACTION_LABELS[reaction.emoji]}
                                  </span>
                                ))}
                              </div>
                            ) : null}

                            <div className={`flex items-center justify-between gap-4 text-xs ${isOwn ? 'text-stone-900/65' : 'text-stone-500'}`}>
                              <div className="flex items-center gap-2">
                                {message.expiresAt ? (
                                  <>
                                    <Clock3 className="h-3.5 w-3.5" />
                                    <span>{formatRelativeCountdown(message.expiresAt)}</span>
                                  </>
                                ) : null}
                              </div>
                              {isOwn ? (
                                <ReceiptIcon state={receiptState} />
                              ) : null}
                            </div>

                            {showContext ? (
                              <div className={`grid gap-2 rounded-[1rem] border p-3 ${isOwn ? 'border-stone-900/10 bg-white/25' : 'border-white/10 bg-white/5'}`}>
                                <p className="text-[11px] uppercase tracking-[0.18em] opacity-70">Quick actions</p>
                                <div className="flex flex-wrap gap-2">
                                  {(['thumbs_up', 'heart', 'fire', 'eyes', 'check', 'handshake'] as ReactionEmoji[]).map((emoji) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      className="rounded-full border border-white/10 px-2 py-1 text-sm"
                                      onClick={() => void reactToMessage(message.id, emoji)}
                                    >
                                      {REACTION_LABELS[emoji]}
                                    </button>
                                  ))}
                                </div>
                                <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em]">
                                  <button type="button" onClick={() => void updateMessageExpiry(message.id, 24)}>24h</button>
                                  <button type="button" onClick={() => void updateMessageExpiry(message.id, 72)}>72h</button>
                                  <button type="button" onClick={() => void updateMessageExpiry(message.id, 168)}>1 week</button>
                                  <button type="button" onClick={() => void updateMessageExpiry(message.id, null)}>Never</button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {typingLabels.length > 0 ? (
                    <div className="flex items-center gap-3 text-sm text-stone-400">
                      <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                        {[0, 1, 2].map((index) => (
                          <span
                            key={index}
                            className="h-2 w-2 rounded-full bg-stone-300/70 animate-pulse"
                            style={{ animationDelay: `${index * 0.15}s` }}
                          />
                        ))}
                      </div>
                      <span>{typingLabels.join(', ')} typing...</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-white/8 px-6 py-5">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/5 text-stone-200">
                    <Paperclip className="h-4 w-4" />
                    <input type="file" className="hidden" onChange={handleFileInput} />
                  </label>
                  <div className="min-w-[240px] flex-1">
                    <textarea
                      value={messageDraft}
                      onChange={(event) => {
                        setMessageDraft(event.target.value);
                        socketRef.current?.emit(
                          event.target.value ? 'typing:start' : 'typing:stop',
                          { dealRoomId: room.id },
                        );
                      }}
                      rows={3}
                      placeholder="Write an encrypted message..."
                      className="w-full rounded-[1.6rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-100 outline-none"
                    />
                  </div>
                  <Button variant="gold" size="lg" onClick={() => void sendMessage()}>
                    <Send className="mr-2 h-4 w-4" />
                    Send
                  </Button>
                </div>
                {uploadingFileId ? (
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-amber-100/70">
                    Encrypting {uploadingFileId} client-side...
                  </p>
                ) : null}
              </div>
            </div>

            <div className="bg-white/[0.02] px-5 py-5">
              <div className="grid gap-4">
                <PanelCard
                  title="Offer thread"
                  icon={<Handshake className="h-4 w-4 text-amber-200" />}
                  action={
                    <Button variant="gold" size="sm" onClick={() => setOfferModalOpen(true)}>
                      Submit offer
                    </Button>
                  }
                >
                  {room.offers.length > 0 ? (
                    room.offers.map((offer) => (
                        <OfferCard
                          key={offer.id}
                          offer={offer}
                          decryptedConditions={offerBodies[offer.id]}
                        />
                    ))
                  ) : (
                    <p className="text-sm text-stone-400">No offers submitted yet.</p>
                  )}
                </PanelCard>

                <PanelCard
                  title="NDA status"
                  icon={<Gavel className="h-4 w-4 text-amber-200" />}
                >
                  <div className="rounded-[1.2rem] border border-white/8 bg-white/3 px-4 py-3">
                    <p className="text-sm text-stone-100">{room.nda?.status ?? room.ndaStatus}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-stone-500">
                      Template {room.nda?.templateVersion ?? 'phase3-v1'}
                    </p>
                  </div>
                  {room.nda?.parties?.length ? (
                    room.nda.parties.map((party) => (
                      <div key={party.participantId} className="flex items-center justify-between text-sm text-stone-300">
                        <span>{party.pseudonym}</span>
                        <span>{party.signedAt ? 'Signed' : 'Pending'}</span>
                      </div>
                    ))
                  ) : null}
                </PanelCard>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="cinematic-panel rounded-[2rem] p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Document vault</p>
                <h2 className="mt-3 text-2xl text-stone-50">Encrypted documents</h2>
              </div>
              <label className="cursor-pointer">
                <span className="sr-only">Upload encrypted document</span>
                <div className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-stone-950">
                  <Paperclip className="h-4 w-4" />
                  Upload
                </div>
                <input type="file" className="hidden" onChange={handleFileInput} />
              </label>
            </div>

            <div className="mt-5 grid gap-4">
              {room.files.map((file) => (
                <div key={file.id} className="rounded-[1.4rem] border border-white/8 bg-white/3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-stone-100">{fileNames[file.id] ?? 'Encrypted file'}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-stone-500">
                        {FILE_CATEGORY_LABELS[file.category]} · {formatBytes(file.sizeBytes)}
                      </p>
                    </div>
                    <Badge>{formatRelativeCountdown(file.expiresAt)}</Badge>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm text-stone-300">
                    <div className="flex items-center justify-between">
                      <span>Uploaded by</span>
                      <span>{file.uploadedByPseudonym ?? participantByUserId.get(file.uploadedBy)?.pseudonym ?? 'Participant'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Date</span>
                      <span>{formatDateTime(file.createdAt)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Downloads</span>
                      <span>{file.downloads}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => void downloadFile(file, false)}>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setViewInlineByFile((current) => ({ ...current, [file.id]: !current[file.id] }));
                        void downloadFile(file, true);
                      }}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      {viewInlineByFile[file.id] ? 'Inline open' : 'View only'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void analyseFile(file)}>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Analyse with AI
                    </Button>
                  </div>

                  {fileAnalyses[file.id] ? (
                    <div className="mt-4 rounded-[1.2rem] border border-amber-300/10 bg-amber-400/6 p-4">
                      <p className="text-sm text-amber-50">{fileAnalyses[file.id].summary}</p>
                      <div className="mt-3 grid gap-2 text-sm text-stone-200">
                        {fileAnalyses[file.id].fields.map((field) => (
                          <div key={field.name} className="flex items-center justify-between gap-3">
                            <span className="text-stone-400">{field.name}</span>
                            <span>{field.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="cinematic-panel rounded-[2rem] p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Action panel</p>
            <div className="mt-5 grid gap-3">
              <Button variant="gold" onClick={() => setOfferModalOpen(true)}>
                <Landmark className="mr-2 h-4 w-4" />
                Make offer
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => void startCall('audio')}
                >
                  <Phone className="mr-2 h-4 w-4" />
                  Audio call
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => void startCall('video')}
                >
                  <Video className="mr-2 h-4 w-4" />
                  Video call
                </Button>
              </div>
              <Button variant="outline" onClick={() => setMeetingSchedulerOpen(true)}>
                <Calendar className="mr-2 h-4 w-4" />
                Schedule meeting
              </Button>
              <Button variant="outline" onClick={() => setNotice('Identity reveal request staged for mutual consent.')}>
                <UnlockKeyhole className="mr-2 h-4 w-4" />
                Identity reveal
              </Button>
            </div>
          </section>

          {meetingRequests.length > 0 && (
            <section className="cinematic-panel rounded-[2rem] p-6">
              <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Meetings</p>
              <div className="mt-4 grid gap-3">
                {meetingRequests.slice(0, 4).map((req) => (
                  <div key={req.id} className="rounded-[1.4rem] border border-white/8 bg-white/3 p-4">
                    <p className="text-sm text-stone-100 capitalize">{req.meetingType.replace(/_/g, ' ')}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-stone-500">
                      {req.durationMinutes < 60 ? `${req.durationMinutes} min` : `${req.durationMinutes / 60}h`} · {req.status}
                    </p>
                    {req.status === 'pending' && req.requestedBy !== user?.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full"
                        onClick={() => setRespondingRequest(req)}
                      >
                        Submit availability
                      </Button>
                    )}
                    {req.status === 'confirmed' && (
                      <a
                        href={api.getMeetingICSUrl(req.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs text-stone-300 hover:border-white/30 hover:text-stone-100 transition-colors"
                      >
                        Download ICS
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {notice ? (
            <section className="cinematic-panel rounded-[2rem] border border-amber-300/10 bg-amber-400/8 p-5 text-sm text-amber-50">
              {notice}
            </section>
          ) : null}

          <DealTeamManager dealRoomId={room.id} />
        </aside>
      </div>

      {ndaModalOpen ? (
        <Modal title="Mutual NDA" onClose={() => setNdaModalOpen(false)}>
          <div className="grid gap-5">
            <div className="rounded-[1.4rem] border border-white/8 bg-white/3 p-4 text-sm leading-7 text-stone-300">
              This mutual NDA protects the confidentiality of the asset, parties, and commercial diligence materials.
              Parties remain pseudonymous until both sides sign and consent to identity reveal.
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                variant={signatureMode === 'typed' ? 'gold' : 'outline'}
                onClick={() => setSignatureMode('typed')}
              >
                Type name
              </Button>
              <Button
                variant={signatureMode === 'drawn' ? 'gold' : 'outline'}
                onClick={() => setSignatureMode('drawn')}
              >
                Draw signature
              </Button>
            </div>

            {signatureMode === 'typed' ? (
              <div className="grid gap-2">
                <Label htmlFor="signature-name">Typed signature</Label>
                <Input
                  id="signature-name"
                  value={signatureName}
                  onChange={(event) => setSignatureName(event.target.value)}
                  placeholder="Enter your signing name"
                />
              </div>
            ) : (
              <div className="grid gap-3">
                <Label>Draw signature</Label>
                <canvas
                  ref={canvasRef}
                  width={520}
                  height={180}
                  className="w-full rounded-[1.4rem] border border-dashed border-white/12 bg-black/20"
                  onPointerDown={drawSignature}
                  onPointerMove={(event) => {
                    if (!drawingRef.current) return;
                    drawSignature(event);
                  }}
                  onPointerUp={endDrawing}
                  onPointerLeave={endDrawing}
                />
                <Button variant="outline" size="sm" onClick={clearSignatureCanvas}>
                  Clear signature
                </Button>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setNdaModalOpen(false)}>Cancel</Button>
              <Button variant="gold" onClick={() => void submitNdaSignature()}>Sign NDA</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <CallOverlay
        callState={callState}
        socket={socketRef.current}
        iceServers={iceServers}
        myPseudonym={currentParticipant?.pseudonym ?? 'You'}
        onCallEnd={async () => {
          if (callLogId) {
            await api.endCall(callLogId);
            setCallLogId(null);
          }
          setCallState({ phase: 'idle' });
        }}
      />

      {meetingSchedulerOpen && (
        <MeetingSchedulerDrawer
          dealRoomId={room.id}
          onSubmit={scheduleMeeting}
          onClose={() => setMeetingSchedulerOpen(false)}
          loading={meetingLoading}
        />
      )}

      {respondingRequest && (
        <MeetingAvailabilityDrawer
          request={respondingRequest}
          myAvailability={null}
          onSubmit={submitAvailability}
          onClose={() => setRespondingRequest(null)}
          loading={meetingLoading}
        />
      )}

      {offerModalOpen ? (
        <Modal title="Submit offer" onClose={() => setOfferModalOpen(false)}>
          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="offer-amount">Amount</Label>
              <Input id="offer-amount" value={offerAmount} onChange={(event) => setOfferAmount(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="offer-currency">Currency</Label>
              <Input id="offer-currency" value={offerCurrency} onChange={(event) => setOfferCurrency(event.target.value.toUpperCase())} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="offer-conditions">Encrypted conditions</Label>
              <textarea
                id="offer-conditions"
                value={offerConditions}
                onChange={(event) => setOfferConditions(event.target.value)}
                className="min-h-[120px] rounded-[1.4rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-100 outline-none"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="offer-expiry">Expiry date</Label>
              <Input id="offer-expiry" type="date" value={offerExpiry} onChange={(event) => setOfferExpiry(event.target.value)} />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setOfferModalOpen(false)}>Cancel</Button>
              <Button variant="gold" onClick={() => void submitOffer()}>Submit offer</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}

function PanelCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.5rem] border border-white/8 bg-white/3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm uppercase tracking-[0.24em] text-stone-400">{title}</h3>
        </div>
        {action}
      </div>
      <div className="mt-4 grid gap-3">{children}</div>
    </section>
  );
}

function OfferCard({
  offer,
  decryptedConditions,
}: {
  offer: Offer;
  decryptedConditions?: string;
}) {
  return (
    <div className="rounded-[1.2rem] border border-white/8 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-lg text-stone-50">{formatCurrency(offer.amount, offer.currency)}</p>
        <Badge>{offer.status}</Badge>
      </div>
      <p className="mt-2 text-sm text-stone-300">{decryptedConditions ?? 'Encrypted offer conditions'}</p>
      <p className="mt-3 text-xs uppercase tracking-[0.18em] text-stone-500">
        {offer.parentOfferId ? 'Counter offer' : 'Initial offer'} · {formatDateTime(offer.createdAt)}
      </p>
    </div>
  );
}

function ReceiptIcon({ state }: { state: 'incoming' | 'sent' | 'delivered' | 'read' }) {
  if (state === 'read') {
    return <CheckCheck className="h-4 w-4 text-sky-700" />;
  }

  if (state === 'delivered') {
    return <CheckCheck className="h-4 w-4 text-stone-900/70" />;
  }

  if (state === 'sent') {
    return <Check className="h-4 w-4 text-stone-900/70" />;
  }

  return null;
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-10">
      <div className="w-full max-w-2xl cinematic-panel rounded-[2rem] p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl text-stone-50">{title}</h2>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
