import { describe, expect, it } from 'vitest';
import { hash, verify } from './bcrypt.js';

// Password hashing (bcrypt) — passwords and OTP codes are never stored in the
// clear. Guards the two properties that matter: the stored value is a real
// bcrypt hash (not the plaintext), and it's salted so identical inputs produce
// different hashes — while both still verify.

describe('password hashing (bcrypt)', () => {
  it('produces a bcrypt hash, never the plaintext', async () => {
    const h = await hash('SuperSecret123');
    expect(h).not.toBe('SuperSecret123');
    expect(h).toMatch(/^\$2[aby]\$/); // bcrypt identifier + cost prefix
    expect(h.length).toBeGreaterThanOrEqual(59);
  });

  it('salts — the same password hashes differently each time, yet both verify', async () => {
    const [h1, h2] = await Promise.all([hash('samePass1'), hash('samePass1')]);
    expect(h1).not.toBe(h2);
    expect(await verify('samePass1', h1)).toBe(true);
    expect(await verify('samePass1', h2)).toBe(true);
  });

  it('verify: the correct password returns true', async () => {
    const h = await hash('correct-horse-battery');
    expect(await verify('correct-horse-battery', h)).toBe(true);
  });

  it('verify: a wrong password returns false', async () => {
    const h = await hash('correct-horse-battery');
    expect(await verify('wrong-password', h)).toBe(false);
  });

  it('verify is case-sensitive', async () => {
    const h = await hash('CaseMatters');
    expect(await verify('casematters', h)).toBe(false);
  });
});
