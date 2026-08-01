import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { testPrisma } from '../../../tests/setup.js';
import { createApp } from '@/server.js';
import { NoopNotifier } from '@/lib/notifier.js';
import { getSentMessages, clearSentMessages } from '@/lib/sms.js';

// ─── Mock Telegram bot ──────────────────────────────────────────────────────

const sentTgMessages: { chatId: number; text: string }[] = [];

const mockBot = {
  api: {
    async sendMessage(chatId: number, text: string): Promise<void> {
      sentTgMessages.push({ chatId, text });
    },
  },
};

function clearTgMessages() {
  sentTgMessages.length = 0;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedUser(opts: {
  phone: string;
  passwordHash?: string;
  telegramId?: bigint;
}): Promise<string> {
  const u = await testPrisma.user.create({
    data: {
      phone: opts.phone,
      name: 'Test User',
      language: 'ru',
      roles: ['passenger'],
      phoneVerifiedAt: new Date(),
      termsAcceptedAt: new Date(),
      passwordHash: opts.passwordHash ?? null,
      telegramId: opts.telegramId ?? null,
    },
  });
  return u.id;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

let appWithBot: Express;
let appNoBot: Express;

beforeEach(() => {
  clearTgMessages();
  clearSentMessages();
  appWithBot = createApp(testPrisma, new NoopNotifier(), mockBot);
  appNoBot = createApp(testPrisma, new NoopNotifier());
});

// Read the OTP code the local dev-fallback captured in the mock buffer.
function capturedCode(phone: string): string {
  const msg = [...getSentMessages()].reverse().find((m) => m.phone === phone);
  return msg!.text.match(/\d{6}/)![0]!;
}

// ─── POST /v1/auth/check-phone ────────────────────────────────────────────────

describe('POST /v1/auth/check-phone', () => {
  it('returns exists=false for unknown phone', async () => {
    const res = await request(appWithBot)
      .post('/v1/auth/check-phone')
      .send({ phone: '+996700000001' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false, hasPassword: false, hasTelegram: false });
  });

  it('returns exists=true, hasPassword=false, hasTelegram=false for user with no extras', async () => {
    await seedUser({ phone: '+996700000002' });

    const res = await request(appWithBot)
      .post('/v1/auth/check-phone')
      .send({ phone: '+996700000002' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: true, hasPassword: false, hasTelegram: false });
  });

  it('returns hasPassword=true when user has a password hash', async () => {
    const hash = await bcrypt.hash('secret', 4);
    await seedUser({ phone: '+996700000003', passwordHash: hash });

    const res = await request(appWithBot)
      .post('/v1/auth/check-phone')
      .send({ phone: '+996700000003' });

    expect(res.body.hasPassword).toBe(true);
    expect(res.body.hasTelegram).toBe(false);
  });

  it('returns hasTelegram=true when user has telegramId', async () => {
    await seedUser({ phone: '+996700000004', telegramId: 99887766n });

    const res = await request(appWithBot)
      .post('/v1/auth/check-phone')
      .send({ phone: '+996700000004' });

    expect(res.body.hasTelegram).toBe(true);
    expect(res.body.hasPassword).toBe(false);
  });

  it('returns both flags true when user has password and telegram', async () => {
    const hash = await bcrypt.hash('secret', 4);
    await seedUser({ phone: '+996700000005', passwordHash: hash, telegramId: 55443322n });

    const res = await request(appWithBot)
      .post('/v1/auth/check-phone')
      .send({ phone: '+996700000005' });

    expect(res.body).toEqual({ exists: true, hasPassword: true, hasTelegram: true });
  });

  it('rejects malformed phone with 400', async () => {
    const res = await request(appWithBot)
      .post('/v1/auth/check-phone')
      .send({ phone: '700000001' });

    expect(res.status).toBe(400);
  });
});

// ─── POST /v1/auth/telegram/otp/send ─────────────────────────────────────────

describe('POST /v1/auth/telegram/otp/send', () => {
  it('sends OTP (Dexatel/local), creates OtpCode row, returns expiresInSec=600', async () => {
    await seedUser({ phone: '+996700001001', telegramId: 11223344n });

    const res = await request(appWithBot)
      .post('/v1/auth/telegram/otp/send')
      .send({ phone: '+996700001001' });

    expect(res.status).toBe(200);
    expect(res.body.expiresInSec).toBe(600);

    const otps = await testPrisma.otpCode.findMany({ where: { phone: '+996700001001' } });
    expect(otps).toHaveLength(1);
    expect(otps[0]!.attempts).toBe(0);

    // Dexatel-era: code goes to the phone, not a bot chat. Locally it lands in
    // the mock buffer.
    expect(capturedCode('+996700001001')).toMatch(/^\d{6}$/);
  });

  it('sends OTP for an UNREGISTERED phone (classical registration)', async () => {
    const res = await request(appWithBot)
      .post('/v1/auth/telegram/otp/send')
      .send({ phone: '+996700099099' });

    expect(res.status).toBe(200);
    expect(res.body.expiresInSec).toBe(600);
    expect(capturedCode('+996700099099')).toMatch(/^\d{6}$/);
  });

  it('sends OTP even when no bot is configured (delivery is Dexatel-side)', async () => {
    await seedUser({ phone: '+996700003001' });

    const res = await request(appNoBot)
      .post('/v1/auth/telegram/otp/send')
      .send({ phone: '+996700003001' });

    expect(res.status).toBe(200);
  });

  it('enforces 1-minute gap (rate limit)', async () => {
    await seedUser({ phone: '+996700004001', telegramId: 88776655n });

    await request(appWithBot)
      .post('/v1/auth/telegram/otp/send')
      .send({ phone: '+996700004001' });

    const second = await request(appWithBot)
      .post('/v1/auth/telegram/otp/send')
      .send({ phone: '+996700004001' });

    expect(second.status).toBe(429);
  });

  it('blocks after 5 sends in 24 hours (daily cap)', async () => {
    const phone = '+996700005001';
    await seedUser({ phone, telegramId: 99001122n });

    for (let i = 0; i < 5; i += 1) {
      await testPrisma.otpCode.create({
        data: {
          phone,
          codeHash: 'seed',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(Date.now() - 70_000 - i * 1000),
        },
      });
    }

    const res = await request(appWithBot)
      .post('/v1/auth/telegram/otp/send')
      .send({ phone });

    expect(res.status).toBe(429);
    expect(res.body.error.details.bucket).toBe('otp_send_day');
  });

  it('rejects malformed phone with 400', async () => {
    const res = await request(appWithBot)
      .post('/v1/auth/telegram/otp/send')
      .send({ phone: '700001001' });

    expect(res.status).toBe(400);
  });

  it('OTP sent via Telegram is verified by POST /auth/phone/verify', async () => {
    const phone = '+996700006001';
    await seedUser({ phone, telegramId: 10203040n });
    await request(appWithBot).post('/v1/auth/telegram/otp/send').send({ phone });

    const code = capturedCode(phone);

    const verify = await request(appWithBot)
      .post('/v1/auth/phone/verify')
      .send({ phone, code });

    expect(verify.status).toBe(200);
    expect(verify.body.kind).toBe('full');
    expect(verify.body.accessToken).toBeTypeOf('string');
  });
});
