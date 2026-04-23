import type sodiumModule from 'libsodium-wrappers';

const PBKDF2_ITERATIONS = 100_000;
const PRIVATE_KEY_SALT_BYTES = 16;
const AES_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const PRIVATE_KEY_PAYLOAD_VERSION = 1;
type SodiumModule = typeof sodiumModule;

let sodiumPromise: Promise<SodiumModule> | null = null;

export interface RawKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface GeneratedKeyPair {
  publicKey: string;
  encryptedPrivateKey: string;
}

export interface EncryptedData {
  ciphertext: string;
  nonce: string;
}

export interface AESEncryptedPayload {
  ciphertext: string;
  iv: string;
  algorithm: 'AES-GCM';
}

interface EncryptedPrivateKeyPayload {
  version: number;
  algorithm: 'AES-256-GCM';
  digest: 'SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

interface WrappedFileKeyPayload {
  ciphertext: string;
  nonce: string;
}

async function loadSodium(): Promise<SodiumModule> {
  if (!sodiumPromise) {
    sodiumPromise =
      typeof window === 'undefined'
        ? loadNodeSodium()
        : import('libsodium-wrappers').then(
            (module) => (module.default ?? module) as SodiumModule,
          );
  }

  return sodiumPromise;
}

async function loadNodeSodium(): Promise<SodiumModule> {
  // The ESM entry shipped by libsodium-wrappers 0.7.16 is missing a sibling file
  // on Node in this workspace, so the server path intentionally uses the CJS export.
  const moduleName = 'node:module';
  const { createRequire } = (await import(moduleName)) as typeof import('node:module');
  const require = createRequire(import.meta.url);
  return require('libsodium-wrappers') as SodiumModule;
}

async function getSodium() {
  const sodium = await loadSodium();
  await sodium.ready;
  return sodium;
}

function getCrypto(): typeof globalThis.crypto {
  return globalThis.crypto;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }

  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function utf8ToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToUtf8(bytes: ArrayBuffer | Uint8Array): string {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new TextDecoder().decode(buffer);
}

function randomBytes(length: number): Uint8Array {
  return getCrypto().getRandomValues(new Uint8Array(length));
}

function arrayBufferToBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function parseEncryptedPrivateKey(encryptedPrivateKey: string): EncryptedPrivateKeyPayload {
  return JSON.parse(bytesToUtf8(base64ToBytes(encryptedPrivateKey))) as EncryptedPrivateKeyPayload;
}

async function derivePasswordKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await getCrypto().subtle.importKey(
    'raw',
    bytesToArrayBuffer(utf8ToBytes(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await getCrypto().subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: bytesToArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    AES_KEY_BYTES * 8,
  );

  return new Uint8Array(bits);
}

async function importAesKey(keyBytes: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return getCrypto().subtle.importKey(
    'raw',
    bytesToArrayBuffer(keyBytes),
    'AES-GCM',
    false,
    [usage],
  );
}

async function encryptAesBuffer(
  plaintext: Uint8Array,
  keyBytes: Uint8Array,
  iv: Uint8Array,
): Promise<ArrayBuffer> {
  const cryptoKey = await importAesKey(keyBytes, 'encrypt');
  return getCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv: bytesToArrayBuffer(iv) },
    cryptoKey,
    bytesToArrayBuffer(plaintext),
  );
}

async function decryptAesBuffer(
  ciphertext: Uint8Array,
  keyBytes: Uint8Array,
  iv: Uint8Array,
): Promise<ArrayBuffer> {
  const cryptoKey = await importAesKey(keyBytes, 'decrypt');
  return getCrypto().subtle.decrypt(
    { name: 'AES-GCM', iv: bytesToArrayBuffer(iv) },
    cryptoKey,
    bytesToArrayBuffer(ciphertext),
  );
}

export async function generateRawKeyPair(): Promise<RawKeyPair> {
  const sodium = await getSodium();
  const keypair = sodium.crypto_box_keypair();

  return {
    publicKey: sodium.to_base64(keypair.publicKey),
    privateKey: sodium.to_base64(keypair.privateKey),
  };
}

export async function encryptPrivateKeyWithPassword(
  privateKey: string,
  password: string,
): Promise<{ encryptedPrivateKey: string }> {
  const salt = randomBytes(PRIVATE_KEY_SALT_BYTES);
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const passwordKey = await derivePasswordKey(password, salt);
  const ciphertext = await encryptAesBuffer(utf8ToBytes(privateKey), passwordKey, iv);

  const payload: EncryptedPrivateKeyPayload = {
    version: PRIVATE_KEY_PAYLOAD_VERSION,
    algorithm: 'AES-256-GCM',
    digest: 'SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(arrayBufferToBytes(ciphertext)),
  };

  return {
    encryptedPrivateKey: bytesToBase64(utf8ToBytes(JSON.stringify(payload))),
  };
}

export async function unlockPrivateKey(
  encryptedPrivateKey: string,
  password: string,
): Promise<string> {
  const payload = parseEncryptedPrivateKey(encryptedPrivateKey);
  const passwordKey = await derivePasswordKey(password, base64ToBytes(payload.salt));
  const plaintext = await decryptAesBuffer(
    base64ToBytes(payload.ciphertext),
    passwordKey,
    base64ToBytes(payload.iv),
  );

  return bytesToUtf8(plaintext);
}

export async function decryptPrivateKeyWithPassword(
  encryptedPrivateKey: string,
  password: string,
): Promise<string> {
  return unlockPrivateKey(encryptedPrivateKey, password);
}

export async function generateKeyPair(password: string): Promise<GeneratedKeyPair> {
  const keyPair = await generateRawKeyPair();
  const { encryptedPrivateKey } = await encryptPrivateKeyWithPassword(keyPair.privateKey, password);

  return {
    publicKey: keyPair.publicKey,
    encryptedPrivateKey,
  };
}

export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: string,
  senderPrivateKey: string,
): Promise<EncryptedData> {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(
    sodium.from_string(plaintext),
    nonce,
    sodium.from_base64(recipientPublicKey),
    sodium.from_base64(senderPrivateKey),
  );

  return {
    ciphertext: sodium.to_base64(ciphertext),
    nonce: sodium.to_base64(nonce),
  };
}

export async function decryptMessage(
  ciphertext: string,
  nonce: string,
  senderPublicKey: string,
  recipientPrivateKey: string,
): Promise<string> {
  const sodium = await getSodium();
  const decrypted = sodium.crypto_box_open_easy(
    sodium.from_base64(ciphertext),
    sodium.from_base64(nonce),
    sodium.from_base64(senderPublicKey),
    sodium.from_base64(recipientPrivateKey),
  );

  return sodium.to_string(decrypted);
}

export async function encryptForRecipient(
  message: string,
  recipientPublicKey: string,
  senderPrivateKey: string,
): Promise<EncryptedData> {
  return encryptMessage(message, recipientPublicKey, senderPrivateKey);
}

export async function decryptFromSender(
  encrypted: EncryptedData,
  senderPublicKey: string,
  recipientPrivateKey: string,
): Promise<string> {
  return decryptMessage(
    encrypted.ciphertext,
    encrypted.nonce,
    senderPublicKey,
    recipientPrivateKey,
  );
}

export async function wrapFileKey(
  fileKey: string,
  recipientPublicKey: string,
  senderPrivateKey: string,
): Promise<string> {
  const wrapped = await encryptMessage(fileKey, recipientPublicKey, senderPrivateKey);
  const payload: WrappedFileKeyPayload = {
    ciphertext: wrapped.ciphertext,
    nonce: wrapped.nonce,
  };

  return bytesToBase64(utf8ToBytes(JSON.stringify(payload)));
}

export async function unwrapFileKey(
  wrappedKey: string,
  senderPublicKey: string,
  recipientPrivateKey: string,
): Promise<string> {
  const payload = JSON.parse(bytesToUtf8(base64ToBytes(wrappedKey))) as WrappedFileKeyPayload;
  return decryptMessage(payload.ciphertext, payload.nonce, senderPublicKey, recipientPrivateKey);
}

export async function encryptFile(
  fileBuffer: ArrayBuffer,
): Promise<{ encryptedBuffer: ArrayBuffer; key: string; nonce: string }> {
  const key = randomBytes(AES_KEY_BYTES);
  const nonce = randomBytes(AES_GCM_IV_BYTES);
  const encryptedBuffer = await encryptAesBuffer(arrayBufferToBytes(fileBuffer), key, nonce);

  return {
    encryptedBuffer,
    key: bytesToBase64(key),
    nonce: bytesToBase64(nonce),
  };
}

export async function decryptFile(
  encryptedBuffer: ArrayBuffer,
  key: string,
  nonce: string,
): Promise<ArrayBuffer> {
  return decryptAesBuffer(
    arrayBufferToBytes(encryptedBuffer),
    base64ToBytes(key),
    base64ToBytes(nonce),
  );
}

export async function generateAES256Key(): Promise<string> {
  return bytesToBase64(randomBytes(AES_KEY_BYTES));
}

export async function encryptAES256(
  plaintext: string,
  keyB64: string,
): Promise<AESEncryptedPayload> {
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const ciphertext = await encryptAesBuffer(
    utf8ToBytes(plaintext),
    base64ToBytes(keyB64),
    iv,
  );

  return {
    ciphertext: bytesToBase64(arrayBufferToBytes(ciphertext)),
    iv: bytesToBase64(iv),
    algorithm: 'AES-GCM',
  };
}

export async function decryptAES256(
  encrypted: AESEncryptedPayload,
  keyB64: string,
): Promise<string> {
  const plaintext = await decryptAesBuffer(
    base64ToBytes(encrypted.ciphertext),
    base64ToBytes(keyB64),
    base64ToBytes(encrypted.iv),
  );

  return bytesToUtf8(plaintext);
}

export async function encryptSymmetric(
  message: string,
  keyB64: string,
): Promise<EncryptedData> {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(
    sodium.from_string(message),
    nonce,
    sodium.from_base64(keyB64),
  );

  return {
    ciphertext: sodium.to_base64(ciphertext),
    nonce: sodium.to_base64(nonce),
  };
}

export async function decryptSymmetric(
  encrypted: EncryptedData,
  keyB64: string,
): Promise<string> {
  const sodium = await getSodium();
  const plaintext = sodium.crypto_secretbox_open_easy(
    sodium.from_base64(encrypted.ciphertext),
    sodium.from_base64(encrypted.nonce),
    sodium.from_base64(keyB64),
  );

  return sodium.to_string(plaintext);
}

export async function deriveKeyFromPassword(
  password: string,
  saltB64?: string,
): Promise<{ keyB64: string; saltB64: string }> {
  const salt = saltB64 ? base64ToBytes(saltB64) : randomBytes(PRIVATE_KEY_SALT_BYTES);
  const key = await derivePasswordKey(password, salt);

  return {
    keyB64: bytesToBase64(key),
    saltB64: bytesToBase64(salt),
  };
}

export function fuzzCoordinates(
  lat: number,
  lng: number,
  maxDeltaDegrees = 0.003,
): { lat: number; lng: number } {
  const fuzzLat = (Math.random() - 0.5) * 2 * maxDeltaDegrees;
  const fuzzLng = (Math.random() - 0.5) * 2 * maxDeltaDegrees;

  return {
    lat: Math.round((lat + fuzzLat) * 1e7) / 1e7,
    lng: Math.round((lng + fuzzLng) * 1e7) / 1e7,
  };
}

export function encodeBase64(value: Uint8Array | ArrayBuffer): string {
  return bytesToBase64(value instanceof Uint8Array ? value : arrayBufferToBytes(value));
}

export function decodeBase64(value: string): Uint8Array {
  return base64ToBytes(value);
}

export function base64ToArrayBuffer(value: string): ArrayBuffer {
  return bytesToArrayBuffer(base64ToBytes(value));
}
