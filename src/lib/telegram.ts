import crypto from 'node:crypto';

/**
 * Validate Telegram Mini App initData per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Algorithm:
 *   1. Parse the `initData` as URL-encoded query string into pairs.
 *   2. Take out the `hash` field; every other field joined as `key=value\n…`
 *      alphabetically gives the `data_check_string`.
 *   3. `secret_key = HMAC_SHA256(bot_token, "WebAppData")`
 *   4. `expected_hash = HMAC_SHA256(data_check_string, secret_key)`
 *   5. Constant-time compare `expected_hash` with the `hash` field.
 *   6. Verify `auth_date` is within freshness window (default 24h).
 */

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: Date;
  raw: URLSearchParams;
}

export interface ValidateOptions {
  maxAgeSeconds?: number;
}

const DEFAULT_MAX_AGE = 24 * 60 * 60;


/** Verifies the WebApp HMAC (secret = HMAC-SHA256("WebAppData", botToken)) and
 *  auth_date freshness for any Telegram-signed URLSearchParams payload
 *  (initData, requestContact response, …). Throws on any mismatch. */
function verifyWebAppSignature(
  params: URLSearchParams,
  botToken: string,
  maxAgeSeconds: number,
): void {
  const hash = params.get('hash');
  if (!hash) throw new Error('payload has no hash');
  const entries: [string, string][] = [];
  params.forEach((value, key) => {
    if (key !== 'hash') entries.push([key, value]);
  });
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const given = Buffer.from(hash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new Error('payload signature mismatch');
  }
  const authDateSec = Number(params.get('auth_date'));
  if (!Number.isFinite(authDateSec) || authDateSec <= 0) {
    throw new Error('payload auth_date is invalid');
  }
  const ageSec = Math.floor(Date.now() / 1000) - authDateSec;
  if (ageSec > maxAgeSeconds) throw new Error('payload is stale');
}

export interface TelegramSharedContact {
  phone_number: string;
  user_id: number;
  first_name?: string;
}

/** Validates the signed `response` string produced by WebApp.requestContact().
 *  Returns the contact whose phone_number Telegram itself verified — the
 *  possession proof for binding a phone without any OTP. */
export function validateTelegramContactResponse(
  response: string,
  botToken: string,
  options: ValidateOptions = {},
): TelegramSharedContact {
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  if (!response) throw new Error('contact response is empty');
  const params = new URLSearchParams(response);
  verifyWebAppSignature(params, botToken, options.maxAgeSeconds ?? DEFAULT_MAX_AGE);
  const contactJson = params.get('contact');
  if (!contactJson) throw new Error('contact response has no contact');
  let contact: TelegramSharedContact;
  try {
    const parsed: unknown = JSON.parse(contactJson);
    if (
      typeof parsed !== 'object' || parsed === null ||
      typeof (parsed as { phone_number?: unknown }).phone_number !== 'string' ||
      typeof (parsed as { user_id?: unknown }).user_id !== 'number'
    ) {
      throw new Error('bad shape');
    }
    contact = parsed as TelegramSharedContact;
  } catch {
    throw new Error('contact is not valid JSON');
  }
  return contact;
}

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  options: ValidateOptions = {},
): ValidatedInitData {
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  if (!initData) throw new Error('initData is empty');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('initData has no hash');

  // Build data-check string — every field except `hash`, alphabetised, joined by \n.
  const entries: [string, string][] = [];
  params.forEach((value, key) => {
    if (key !== 'hash') entries.push([key, value]);
  });
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  // Constant-time compare to prevent timing attacks.
  const given = Buffer.from(hash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new Error('initData signature mismatch');
  }

  const authDateSec = Number(params.get('auth_date'));
  if (!Number.isFinite(authDateSec) || authDateSec <= 0) {
    throw new Error('initData auth_date is invalid');
  }
  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE;
  const ageSec = Math.floor(Date.now() / 1000) - authDateSec;
  if (ageSec > maxAge) throw new Error('initData is stale');

  const userJson = params.get('user');
  if (!userJson) throw new Error('initData has no user');
  let user: TelegramUser;
  try {
    const parsed: unknown = JSON.parse(userJson);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { id?: unknown }).id !== 'number' ||
      typeof (parsed as { first_name?: unknown }).first_name !== 'string'
    ) {
      throw new Error('bad shape');
    }
    user = parsed as TelegramUser;
  } catch {
    throw new Error('initData user is not valid JSON');
  }

  return {
    user,
    authDate: new Date(authDateSec * 1000),
    raw: params,
  };
}

/**
 * Build a valid initData string for tests. Mirrors the validation algorithm.
 */
export function buildTestInitData(
  fields: Record<string, string>,
  botToken: string,
): string {
  const entries = Object.entries(fields).filter(([k]) => k !== 'hash');
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const out = new URLSearchParams();
  entries.forEach(([k, v]) => out.append(k, v));
  out.append('hash', hash);
  return out.toString();
}
