import _sodium from 'libsodium-wrappers';

async function getSodium() {
  await _sodium.ready;
  return _sodium;
}

export interface KeyPair {
  publicKey: string;    // base64-encoded
  privateKey: string;   // base64-encoded (store encrypted)
}

export interface EncryptedData {
  ciphertext: string;   // base64-encoded
  nonce: string;        // base64-encoded
}

// ─── Key Generation ───────────────────────────────────────────────────────────

export async function generateKeyPair(): Promise<KeyPair> {
  const sodium = await getSodium();
  const keypair = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_base64(keypair.publicKey),
    privateKey: sodium.to_base64(keypair.privateKey),
  };
}

// ─── Asymmetric Encryption (Box) ─────────────────────────────────────────────

export async function encryptForRecipient(
  message: string,
  recipientPublicKeyB64: string,
  senderPrivateKeyB64: string,
): Promise<EncryptedData> {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const recipientPublicKey = sodium.from_base64(recipientPublicKeyB64);
  const senderPrivateKey = sodium.from_base64(senderPrivateKeyB64);
  const messageBytes = sodium.from_string(message);

  const ciphertext = sodium.crypto_box_easy(
    messageBytes,
    nonce,
    recipientPublicKey,
    senderPrivateKey,
  );

  return {
    ciphertext: sodium.to_base64(ciphertext),
    nonce: sodium.to_base64(nonce),
  };
}

export async function decryptFromSender(
  encrypted: EncryptedData,
  senderPublicKeyB64: string,
  recipientPrivateKeyB64: string,
): Promise<string> {
  const sodium = await getSodium();
  const senderPublicKey = sodium.from_base64(senderPublicKeyB64);
  const recipientPrivateKey = sodium.from_base64(recipientPrivateKeyB64);
  const ciphertext = sodium.from_base64(encrypted.ciphertext);
  const nonce = sodium.from_base64(encrypted.nonce);

  const decrypted = sodium.crypto_box_open_easy(
    ciphertext,
    nonce,
    senderPublicKey,
    recipientPrivateKey,
  );

  return sodium.to_string(decrypted);
}

// ─── Symmetric Encryption (SecretBox) ────────────────────────────────────────

export async function encryptSymmetric(
  message: string,
  keyB64: string,
): Promise<EncryptedData> {
  const sodium = await getSodium();
  const key = sodium.from_base64(keyB64);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const messageBytes = sodium.from_string(message);
  const ciphertext = sodium.crypto_secretbox_easy(messageBytes, nonce, key);

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
  const key = sodium.from_base64(keyB64);
  const ciphertext = sodium.from_base64(encrypted.ciphertext);
  const nonce = sodium.from_base64(encrypted.nonce);

  const decrypted = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  return sodium.to_string(decrypted);
}

// ─── Password-Based Key Derivation ───────────────────────────────────────────

export async function deriveKeyFromPassword(
  password: string,
  saltB64?: string,
): Promise<{ keyB64: string; saltB64: string }> {
  const sodium = await getSodium();
  const salt = saltB64
    ? sodium.from_base64(saltB64)
    : sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);

  const key = sodium.crypto_pwhash(
    32,
    sodium.from_string(password),
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_DEFAULT,
  );

  return {
    keyB64: sodium.to_base64(key),
    saltB64: sodium.to_base64(salt),
  };
}

export async function encryptPrivateKeyWithPassword(
  privateKeyB64: string,
  password: string,
): Promise<{ encryptedPrivateKey: string; salt: string }> {
  const { keyB64, saltB64 } = await deriveKeyFromPassword(password);
  const encrypted = await encryptSymmetric(privateKeyB64, keyB64);
  return {
    encryptedPrivateKey: JSON.stringify(encrypted),
    salt: saltB64,
  };
}

export async function decryptPrivateKeyWithPassword(
  encryptedPrivateKey: string,
  password: string,
  saltB64: string,
): Promise<string> {
  const { keyB64 } = await deriveKeyFromPassword(password, saltB64);
  const encrypted = JSON.parse(encryptedPrivateKey) as EncryptedData;
  return decryptSymmetric(encrypted, keyB64);
}

// ─── Coordinate Fuzzing ───────────────────────────────────────────────────────

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
