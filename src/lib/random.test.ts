import { describe, expect, it } from 'vitest';
import { generateOtp, generateRefreshTokenPlain, sha256Hex } from './random.js';

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
