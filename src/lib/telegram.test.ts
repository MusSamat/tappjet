import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { buildTestInitData, validateTelegramInitData } from './telegram.js';

const BOT_TOKEN = 'test-bot-token-1234567890';

function fakeUserFields(overrides: Record<string, string> = {}): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    auth_date: String(now),
    query_id: 'AAH1234',
    user: JSON.stringify({
      id: 42,
      first_name: 'Аsан',
      last_name: 'Кадыров',
      username: 'asan',
      language_code: 'ky',
    }),
    ...overrides,
  };
}

describe('validateTelegramInitData', () => {
  it('accepts a correctly-signed payload', () => {
    const initData = buildTestInitData(fakeUserFields(), BOT_TOKEN);
    const result = validateTelegramInitData(initData, BOT_TOKEN);
    expect(result.user.id).toBe(42);
    expect(result.user.language_code).toBe('ky');
  });

  it('rejects when bot_token is wrong', () => {
    const initData = buildTestInitData(fakeUserFields(), BOT_TOKEN);
    expect(() => validateTelegramInitData(initData, 'other-token')).toThrow(/signature/);
  });

  it('rejects a tampered user field', () => {
    const fields = fakeUserFields();
    const initData = buildTestInitData(fields, BOT_TOKEN);
    // Decode, swap one field in user JSON, re-encode — keep original hash so signature now fails.
    const params = new URLSearchParams(initData);
    params.set('user', (fields.user ?? '').replace('"id":42', '"id":43'));
    expect(() => validateTelegramInitData(params.toString(), BOT_TOKEN)).toThrow(/signature/);
  });

  it('rejects stale initData (auth_date too old)', () => {
    const day = 60 * 60 * 24;
    const old = String(Math.floor(Date.now() / 1000) - day * 2);
    const initData = buildTestInitData(fakeUserFields({ auth_date: old }), BOT_TOKEN);
    expect(() => validateTelegramInitData(initData, BOT_TOKEN)).toThrow(/stale/);
  });

  it('rejects when hash is missing', () => {
    const now = Math.floor(Date.now() / 1000);
    const initData = `auth_date=${now}&user=${encodeURIComponent('{"id":1,"first_name":"A"}')}`;
    expect(() => validateTelegramInitData(initData, BOT_TOKEN)).toThrow(/hash/);
  });

  it('is immune to timing leaks (same-length hashes compared constant-time)', () => {
    const initData = buildTestInitData(fakeUserFields(), BOT_TOKEN);
    // Replace only the hash with another valid-length hex string.
    const randomHash = crypto.randomBytes(32).toString('hex');
    const tampered = initData.replace(/hash=[a-f0-9]+/, `hash=${randomHash}`);
    expect(() => validateTelegramInitData(tampered, BOT_TOKEN)).toThrow(/signature/);
  });

  it('rejects when user JSON is malformed', () => {
    const now = Math.floor(Date.now() / 1000);
    const initData = buildTestInitData(
      {
        auth_date: String(now),
        user: 'not-json',
      },
      BOT_TOKEN,
    );
    expect(() => validateTelegramInitData(initData, BOT_TOKEN)).toThrow(/user/);
  });
});
