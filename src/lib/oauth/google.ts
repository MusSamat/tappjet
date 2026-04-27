import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '@/config/env.js';

/**
 * Verify a Google ID token (v2.1 §8.3).
 * Spec: https://developers.google.com/identity/openid-connect/openid-connect#validatinganidtoken
 *
 * Strategy:
 *   • Fetch Google's JWKS from the discovery URL. `createRemoteJWKSet` caches
 *     the keys in-memory with a short cool-down window, which is what Google
 *     recommends — we don't need an external cache.
 *   • Verify signature + standard claims (iss, exp, nbf) and enforce audience
 *     against GOOGLE_CLIENT_IDS (comma-separated so Flutter + Web can use
 *     separate OAuth clients).
 *
 * Returns a narrow shape with the fields we care about; `sub` is the stable
 * Google user id and becomes `auth_providers.provider_user_id`.
 */

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GOOGLE_ISS_ACCEPTED = new Set(['https://accounts.google.com', 'accounts.google.com']);

export interface GoogleIdToken {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  locale?: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdToken> {
  const allowed = env.GOOGLE_CLIENT_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) {
    throw new Error('GOOGLE_CLIENT_IDS is not configured');
  }
  const { payload } = await jwtVerify(idToken, JWKS, {
    audience: allowed,
  });
  if (!payload.iss || !GOOGLE_ISS_ACCEPTED.has(String(payload.iss))) {
    throw new Error('Google iss mismatch');
  }
  const sub = payload.sub;
  if (!sub) throw new Error('Google token missing sub');
  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    email_verified:
      typeof payload.email_verified === 'boolean' ? payload.email_verified : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    given_name: typeof payload.given_name === 'string' ? payload.given_name : undefined,
    family_name: typeof payload.family_name === 'string' ? payload.family_name : undefined,
    locale: typeof payload.locale === 'string' ? payload.locale : undefined,
  };
}
