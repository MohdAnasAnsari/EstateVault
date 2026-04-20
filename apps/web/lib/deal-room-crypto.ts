'use client';

import {
  base64ToArrayBuffer,
  decryptAES256,
  decryptFile,
  decryptMessage,
  encodeBase64,
  encryptAES256,
  encryptFile,
  generateAES256Key,
  unwrapFileKey,
  wrapFileKey,
} from '@vault/crypto';
import type { DealRoomParticipant } from '@vault/types';

interface DealRoomEnvelopePayload {
  algorithm: 'aes-envelope-v1';
  ciphertext: string;
  wrappedKeys: Record<string, string>;
}

export async function encryptDealRoomEnvelope(input: {
  plaintext: string;
  senderPrivateKey: string;
  participants: DealRoomParticipant[];
}): Promise<{ ciphertext: string; nonce: string }> {
  const key = await generateAES256Key();
  const encrypted = await encryptAES256(input.plaintext, key);

  const wrappedEntries = await Promise.all(
    input.participants
      .filter((participant) => participant.publicKey)
      .map(async (participant) => [
        participant.userId,
        await wrapFileKey(key, participant.publicKey!, input.senderPrivateKey),
      ] as const),
  );

  return {
    ciphertext: JSON.stringify({
      algorithm: 'aes-envelope-v1',
      ciphertext: encrypted.ciphertext,
      wrappedKeys: Object.fromEntries(wrappedEntries),
    } satisfies DealRoomEnvelopePayload),
    nonce: encrypted.iv,
  };
}

export async function decryptDealRoomEnvelope(input: {
  ciphertext: string;
  nonce: string;
  senderPublicKey: string;
  recipientPrivateKey: string;
  userId: string;
}): Promise<string> {
  try {
    const payload = JSON.parse(input.ciphertext) as DealRoomEnvelopePayload;
    if (payload.algorithm === 'aes-envelope-v1') {
      const wrappedKey = payload.wrappedKeys[input.userId];
      if (!wrappedKey) throw new Error('Missing wrapped key for current user');
      const key = await unwrapFileKey(wrappedKey, input.senderPublicKey, input.recipientPrivateKey);
      return decryptAES256(
        {
          ciphertext: payload.ciphertext,
          iv: input.nonce,
          algorithm: 'AES-GCM',
        },
        key,
      );
    }
  } catch {
    // Fall back to direct public-key decryption for older payloads.
  }

  return decryptMessage(
    input.ciphertext,
    input.nonce,
    input.senderPublicKey,
    input.recipientPrivateKey,
  );
}

export async function encryptDealRoomFile(input: {
  file: File;
  senderPrivateKey: string;
  participants: DealRoomParticipant[];
}): Promise<{
  encryptedBlobBase64: string;
  nonce: string;
  wrappedKeys: Record<string, string>;
}> {
  const encrypted = await encryptFile(await input.file.arrayBuffer());
  const wrappedEntries = await Promise.all(
    input.participants
      .filter((participant) => participant.publicKey)
      .map(async (participant) => [
        participant.userId,
        await wrapFileKey(encrypted.key, participant.publicKey!, input.senderPrivateKey),
      ] as const),
  );

  return {
    encryptedBlobBase64: encodeBase64(encrypted.encryptedBuffer),
    nonce: encrypted.nonce,
    wrappedKeys: Object.fromEntries(wrappedEntries),
  };
}

export async function decryptDealRoomFile(input: {
  encryptedBlobBase64: string;
  nonce: string;
  wrappedKeys: Record<string, string>;
  senderPublicKey: string;
  recipientPrivateKey: string;
  userId: string;
}): Promise<ArrayBuffer> {
  const wrappedKey = input.wrappedKeys[input.userId];
  if (!wrappedKey) {
    throw new Error('No wrapped file key found for this user');
  }

  const fileKey = await unwrapFileKey(wrappedKey, input.senderPublicKey, input.recipientPrivateKey);
  return decryptFile(base64ToArrayBuffer(input.encryptedBlobBase64), fileKey, input.nonce);
}
