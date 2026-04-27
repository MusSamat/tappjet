import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { testPrisma } from '../../../tests/setup.js';
import { createApp } from '@/server.js';
import { buildTestInitData } from '@/lib/telegram.js';
import { clearSentMessages, getSentMessages } from '@/lib/sms.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

let app: Express;

beforeEach(() => {
  app = createApp(testPrisma);
  clearSentMessages();
});

describe('POST /v1/auth/telegram', () => {
  it('creates a new user on first login and returns tokens', async () => {
    const initData = buildTestInitData(
      {
        auth_date: String(Math.floor(Date.now() / 1000)),
        query_id: 'QQ',
        user: JSON.stringify({ id: 123456, first_name: 'Test', language_code: 'ky' }),
      },
      BOT_TOKEN,
    );

    const res = await request(app).post('/v1/auth/telegram').send({ initData });

    // Phone not required for now — Telegram login returns full auth immediately.
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('full');
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeTypeOf('string');

    const dbUser = await testPrisma.user.findFirst({ where: { telegramId: 123456n } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.phoneVerifiedAt).toBeNull();
    expect(dbUser!.roles).toContain('passenger');

    const provider = await testPrisma.authProvider.findFirst({
      where: { userId: dbUser!.id, provider: 'telegram' },
    });
    expect(provider).not.toBeNull();
  });

  it('returns existing user on subsequent login (no duplicate row)', async () => {
    const initData = buildTestInitData(
      {
        auth_date: String(Math.floor(Date.now() / 1000)),
        query_id: 'QQ',
        user: JSON.stringify({ id: 789, first_name: 'Test' }),
      },
      BOT_TOKEN,
    );
    await request(app).post('/v1/auth/telegram').send({ initData });
    await request(app).post('/v1/auth/telegram').send({ initData });

    const count = await testPrisma.user.count({ where: { telegramId: 789n } });
    expect(count).toBe(1);
  });

  it('rejects a tampered initData with 401', async () => {
    const fields = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 1, first_name: 'X' }),
    };
    const initData = buildTestInitData(fields, BOT_TOKEN);
    // Modify the user JSON but keep the original hash so signature check fails.
    const params = new URLSearchParams(initData);
    params.set('user', fields.user.replace('"id":1', '"id":2'));
    const tampered = params.toString();
    const res = await request(app).post('/v1/auth/telegram').send({ initData: tampered });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /v1/auth/phone/send-otp', () => {
  it('creates an otp_codes row and captures a mock SMS', async () => {
    const res = await request(app)
      .post('/v1/auth/phone/send-otp')
      .send({ phone: '+996700111222' });

    expect(res.status).toBe(200);
    // v2.1 §7.6: OTP TTL is now 10 minutes.
    expect(res.body.expiresInSec).toBe(600);

    const otps = await testPrisma.otpCode.findMany({ where: { phone: '+996700111222' } });
    expect(otps).toHaveLength(1);
    expect(otps[0]!.attempts).toBe(0);
    expect(getSentMessages()).toHaveLength(1);
    expect(getSentMessages()[0]!.phone).toBe('+996700111222');
  });

  it('rejects a malformed phone with 400', async () => {
    const res = await request(app).post('/v1/auth/phone/send-otp').send({ phone: '996700111222' });
    expect(res.status).toBe(400);
  });

  it('enforces 1-minute gap per phone (service-level)', async () => {
    await request(app).post('/v1/auth/phone/send-otp').send({ phone: '+996700111222' });
    const second = await request(app)
      .post('/v1/auth/phone/send-otp')
      .send({ phone: '+996700111222' });
    expect(second.status).toBe(429);
  });

  it('blocks after 5 SMS in 24 hours (daily cap)', async () => {
    const phone = '+996700999888';
    // Seed 5 existing OTP rows so the cap is already reached before this test.
    for (let i = 0; i < 5; i += 1) {
      await testPrisma.otpCode.create({
        data: {
          phone,
          codeHash: 'seed',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(Date.now() - 60_001 - i * 1000), // >1 min apart
        },
      });
    }
    const res = await request(app).post('/v1/auth/phone/send-otp').send({ phone });
    expect(res.status).toBe(429);
    expect(res.body.error.details.bucket).toBe('otp_send_day');
  });
});

describe('POST /v1/auth/phone/verify', () => {
  async function seedOtp(phone: string, code: string): Promise<void> {
    const codeHash = await bcrypt.hash(code, 4);
    await testPrisma.otpCode.create({
      data: { phone, codeHash, expiresAt: new Date(Date.now() + 5 * 60_000) },
    });
  }

  it('verifies the code and returns tokens + user', async () => {
    const phone = '+996700123456';
    await seedOtp(phone, '123456');

    const res = await request(app)
      .post('/v1/auth/phone/verify')
      .send({ phone, code: '123456', channel: 'mobile' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.user.phone).toBe(phone);
    expect(res.body.user.phoneVerified).toBe(true);

    const dbUser = await testPrisma.user.findFirst({ where: { phone } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.phoneVerifiedAt).not.toBeNull();
  });

  it('rejects an expired OTP with OTP_EXPIRED (410)', async () => {
    const phone = '+996700000001';
    const codeHash = await bcrypt.hash('111111', 4);
    await testPrisma.otpCode.create({
      data: { phone, codeHash, expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post('/v1/auth/phone/verify')
      .send({ phone, code: '111111' });

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('counts attempts and blocks after 5 wrong codes (brute-force)', async () => {
    const phone = '+996700555666';
    await seedOtp(phone, '999999');

    for (let i = 0; i < 5; i += 1) {
      const r = await request(app)
        .post('/v1/auth/phone/verify')
        .send({ phone, code: '000000' });
      expect(r.status).toBe(400); // OTP_WRONG
    }
    const sixth = await request(app)
      .post('/v1/auth/phone/verify')
      .send({ phone, code: '999999' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('does not allow the same OTP to be reused after success', async () => {
    const phone = '+996700444444';
    await seedOtp(phone, '424242');

    const first = await request(app)
      .post('/v1/auth/phone/verify')
      .send({ phone, code: '424242' });
    expect(first.status).toBe(200);

    // Second attempt with the same code should fail — OTP is marked used.
    const second = await request(app)
      .post('/v1/auth/phone/verify')
      .send({ phone, code: '424242' });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('OTP_WRONG');
  });
});

describe('POST /v1/auth/refresh (rotation)', () => {
  async function registerViaOtp(phone: string): Promise<{
    access: string;
    refresh: string;
  }> {
    const code = '654321';
    const codeHash = await bcrypt.hash(code, 4);
    await testPrisma.otpCode.create({
      data: { phone, codeHash, expiresAt: new Date(Date.now() + 5 * 60_000) },
    });
    const res = await request(app).post('/v1/auth/phone/verify').send({ phone, code });
    return { access: res.body.accessToken, refresh: res.body.refreshToken };
  }

  it('rotates: returns new pair and revokes the old refresh', async () => {
    const tokens = await registerViaOtp('+996700777000');
    const refreshRes = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: tokens.refresh, channel: 'mobile' });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTypeOf('string');
    expect(refreshRes.body.refreshToken).not.toBe(tokens.refresh);

    // Re-using the old refresh must fail.
    const replay = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: tokens.refresh, channel: 'mobile' });
    expect(replay.status).toBe(401);
  });

  it('rejects a refresh token whose stored row was revoked', async () => {
    const tokens = await registerViaOtp('+996700777111');
    // Revoke all refresh tokens for this user.
    await testPrisma.refreshToken.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const res = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: tokens.refresh });
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/auth/logout', () => {
  it('revokes the refresh token (idempotent)', async () => {
    const code = '111111';
    const phone = '+996700222111';
    const codeHash = await bcrypt.hash(code, 4);
    await testPrisma.otpCode.create({
      data: { phone, codeHash, expiresAt: new Date(Date.now() + 5 * 60_000) },
    });
    const loginRes = await request(app).post('/v1/auth/phone/verify').send({ phone, code });
    const refreshToken = loginRes.body.refreshToken;

    const out = await request(app).post('/v1/auth/logout').send({ refreshToken });
    expect(out.status).toBe(204);

    const row = await testPrisma.refreshToken.findFirst({ where: { userId: loginRes.body.user.id } });
    expect(row!.revokedAt).not.toBeNull();
  });
});

describe('POST /v1/auth/admin/login', () => {
  it('accepts valid email + password, rejects wrong password', async () => {
    const passwordHash = await bcrypt.hash('S3cretPass!', 4);
    await testPrisma.admin.create({
      data: { email: 'ops@tappjet.kg', passwordHash, name: 'Ops', role: 'admin' },
    });

    const ok = await request(app)
      .post('/v1/auth/admin/login')
      .send({ email: 'ops@tappjet.kg', password: 'S3cretPass!' });
    expect(ok.status).toBe(200);
    expect(ok.body.admin.role).toBe('admin');

    const bad = await request(app)
      .post('/v1/auth/admin/login')
      .send({ email: 'ops@tappjet.kg', password: 'wrong-one' });
    expect(bad.status).toBe(401);
  });

  it('does not leak whether email exists (timing-safe-ish)', async () => {
    const res = await request(app)
      .post('/v1/auth/admin/login')
      .send({ email: 'ghost@nowhere.kg', password: 'whatever123' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('GET /health', () => {
  it('returns 200 when DB is reachable', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.db).toBe('ok');
  });
});

// Silence unused vi import if no mocks added later
void vi;
