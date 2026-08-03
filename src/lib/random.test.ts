import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { generateOtp, generateUuid, generateRefreshTokenPlain, sha256Hex } from './random.js';

describe('OTP generator', () => {
  it('emits exactly six digits', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it('produces distinct values (entropy sanity)', () => {
    const sample = new Set<string>();
    for (let i = 0; i < 50; i += 1) sample.add(generateOtp());
    expect(sample.size).toBeGreaterThan(40);
  });

  it('rejects a draw equal to the bound (1_000_000) and resamples — never 7 digits', () => {
    // First draw = exactly 1_000_000 (0x0F4240) → must be rejected by `n >= 1_000_000`;
    // second draw = 123456 → accepted. A `>` boundary mutant would emit "1000000".
    const spy = vi
      .spyOn(crypto, 'randomBytes')
      .mockReturnValueOnce(Buffer.from([0x0f, 0x42, 0x40]) as never) // → 1_000_000
      .mockReturnValueOnce(Buffer.from([0x01, 0xe2, 0x40]) as never); // → 123456
    const code = generateOtp();
    expect(code).toBe('123456');
    expect(code).toHaveLength(6);
    spy.mockRestore();
  });
});

describe('UUID generator', () => {
  it('returns a v4 UUID and distinct values', () => {
    const u = generateUuid();
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(generateUuid()).not.toBe(u);
  });
});

describe('refresh token', () => {
  it('is base64url with enough entropy', () => {
    const t = generateRefreshTokenPlain();
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('sha256Hex', () => {
  it('is deterministic and 64 hex chars', () => {
    const a = sha256Hex('hello');
    const b = sha256Hex('hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
