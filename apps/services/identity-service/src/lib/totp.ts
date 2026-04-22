import { authenticator } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = process.env['TOTP_ISSUER'] ?? 'EstateVault';

authenticator.options = {
  window: 1,
  step: 30,
  digits: 6,
};

// ─── generateTotpSecret ───────────────────────────────────────────────────────

export interface TotpSecretResult {
  secret: string;
  otpauthUrl: string;
}

export function generateTotpSecret(email: string): TotpSecretResult {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(email, ISSUER, secret);
  return { secret, otpauthUrl };
}

// ─── verifyTotpToken ──────────────────────────────────────────────────────────

export function verifyTotpToken(secret: string, token: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

// ─── generateQRCode ───────────────────────────────────────────────────────────

export async function generateQRCode(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}

// ─── generateBackupCodes ──────────────────────────────────────────────────────

export function generateBackupCodes(): string[] {
  return Array.from({ length: 8 }, () =>
    Math.random().toString(36).slice(2, 10).toUpperCase(),
  );
}
