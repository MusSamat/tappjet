import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '@/config/env.js';

/**
 * Verify an Apple identity token (Sign in with Apple) — TZ v2.1 §8.3.
 * Spec: https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_rest_api/authenticating_users_with_sign_in_with_apple
 */

const JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const APPLE_ISS = 'https://appleid.apple.com';

export interface AppleIdentityToken {
  sub: string;
  email?: string;
  email_verified?: boolean | 'true' | 'false';
  is_private_email?: boolean | 'true' | 'false';
}

export async function verifyAppleIdentityToken(identityToken: string): Promise<AppleIdentityToken> {
  const allowed = env.APPLE_CLIENT_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) {
    throw new Error('APPLE_CLIENT_IDS is not configured');
  }
  const { payload } = await jwtVerify(identityToken, JWKS, {
    audience: allowed,
    issuer: APPLE_ISS,
  });
  const sub = payload.sub;
  if (!sub) throw new Error('Apple token missing sub');
  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    email_verified:
      typeof payload.email_verified === 'boolean' || typeof payload.email_verified === 'string'
        ? (payload.email_verified as boolean | 'true' | 'false')
        : undefined,
    is_private_email:
      typeof payload.is_private_email === 'boolean' || typeof payload.is_private_email === 'string'
        ? (payload.is_private_email as boolean | 'true' | 'false')
        : undefined,
  };
}
