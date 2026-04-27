import crypto from 'node:crypto';

/**
 * Cryptographically random 6-digit OTP, zero-padded.
 * Uniform over 0..999999 (no modulo bias).
 */
export function generateOtp(): string {
  // 1_000_000 fits in 20 bits; reject and resample until below the bound.
  let n: number;
  do {
    n = crypto.randomBytes(3).readUIntBE(0, 3) & 0xfffff; // 20 bits = 1_048_576 max
  } while (n >= 1_000_000);
  return n.toString().padStart(6, '0');
}

export function generateUuid(): string {
  return crypto.randomUUID();
}

export function generateRefreshTokenPlain(): string {
  // 48 bytes base64url ≈ 64 characters — enough entropy to be unguessable.
  return crypto.randomBytes(48).toString('base64url');
}

/**
 * sha256 digest — used to store refresh-token handles in DB without ever
 * persisting the plain token server-side.
 */
export function sha256Hex(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex');
}
