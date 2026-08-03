import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { testPrisma } from '../../../tests/setup.js';
import { createApp } from '@/server.js';
import { NoopNotifier } from '@/lib/notifier.js';

// Integration tests for the CLASSICAL registration used by the web + Flutter
// clients: POST /v1/auth/register with phone + Telegram OTP + name/surname +
// password, all committed in one step (no account is created before the OTP is
// verified). Covers the happy path and every rejection branch, plus the
// security invariants (OTP single-use, password stored as a hash, never leaked).

let app: Express;

beforeEach(() => {
  app = createApp(testPrisma, new NoopNotifier());
});

const PHONE = '+996700123456';
const VALID = { name: 'Мурат', surname: 'Осмонов', password: 'secret123' };

/** Seed a known, unused OTP for a phone (the send-OTP step is tested elsewhere). */
async function seedOtp(phone: string, code: string): Promise<void> {
  await testPrisma.otpCode.create({
    data: { phone, codeHash: await bcrypt.hash(code, 4), expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
}

function register(body: Record<string, unknown>) {
  return request(app).post('/v1/auth/register').send(body);
}

describe('POST /v1/auth/register — classical registration', () => {
  it('registers a new passenger and returns a full session', async () => {
    await seedOtp(PHONE, '123456');

    const res = await register({ phone: PHONE, code: '123456', ...VALID });

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('full');
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeTypeOf('string');
    expect(res.body.user.phone).toBe(PHONE);
    expect(res.body.user.name).toBe('Мурат');
    expect(res.body.user.roles).toEqual(['passenger']);
    expect(res.body.user.phoneVerified).toBe(true);
    expect(res.body.user.providers).toContain('phone');
    // The hash must never leak to the client.
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('persists the user with a phone-verified account and a bcrypt password hash', async () => {
    await seedOtp(PHONE, '123456');
    await register({ phone: PHONE, code: '123456', ...VALID });

    const user = await testPrisma.user.findFirst({ where: { phone: PHONE } });
    expect(user).not.toBeNull();
    expect(user!.phoneVerifiedAt).not.toBeNull();
    expect(user!.passwordHash).toBeTruthy();
    expect(user!.passwordHash).not.toBe(VALID.password); // stored hashed, not plaintext
    expect(await bcrypt.compare(VALID.password, user!.passwordHash!)).toBe(true);

    // A refresh token row was issued for the new session.
    const tokens = await testPrisma.refreshToken.findMany({ where: { userId: user!.id } });
    expect(tokens).toHaveLength(1);
  });

  it('consumes the OTP — the same code cannot register twice', async () => {
    await seedOtp(PHONE, '123456');
    const first = await register({ phone: PHONE, code: '123456', ...VALID });
    expect(first.status).toBe(201);

    const otp = await testPrisma.otpCode.findFirst({ where: { phone: PHONE } });
    expect(otp!.usedAt).not.toBeNull(); // marked used

    const replay = await register({ phone: '+996700123457', code: '123456', ...VALID });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('OTP_WRONG');
  });

  it('rejects a wrong OTP with 400 OTP_WRONG', async () => {
    await seedOtp(PHONE, '123456');
    const res = await register({ phone: PHONE, code: '000000', ...VALID });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_WRONG');
    // No account is created when the OTP fails.
    expect(await testPrisma.user.findFirst({ where: { phone: PHONE } })).toBeNull();
  });

  it('rejects when no OTP was ever requested', async () => {
    const res = await register({ phone: PHONE, code: '123456', ...VALID });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_WRONG');
  });

  it('rejects a weak password (no digit) with 400 VALIDATION_ERROR', async () => {
    await seedOtp(PHONE, '123456');
    const res = await register({ phone: PHONE, code: '123456', ...VALID, password: 'onlyletters' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a too-short password with 400 VALIDATION_ERROR', async () => {
    await seedOtp(PHONE, '123456');
    const res = await register({ phone: PHONE, code: '123456', ...VALID, password: 'a1b2' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed phone with 400 VALIDATION_ERROR', async () => {
    const res = await register({ phone: '0700123456', code: '123456', ...VALID });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a second registration on an already-registered phone with 409', async () => {
    await seedOtp(PHONE, '111111');
    await register({ phone: PHONE, code: '111111', ...VALID });

    await seedOtp(PHONE, '222222'); // a fresh valid OTP — the block is the account, not the code
    const res = await register({ phone: PHONE, code: '222222', ...VALID });
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('already_registered');
  });
});
