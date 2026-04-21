import { authenticator } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = process.env['TOTP_ISSUER'] ?? 'EstateVault';

authenticator.options = {
  window: 1,
  step: 30,
  digits: 6,
};

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export async function generateTotpQrCode(email: string, secret: string): Promise<string> {
  const otpauth = authenticator.keyuri(email, ISSUER, secret);
  return QRCode.toDataURL(otpauth);
}

export function verifyTotpCode(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

export function generateBackupCodes(): string[] {
  return Array.from({ length: 8 }, () =>
    Math.random().toString(36).slice(2, 10).toUpperCase(),
  );
}
