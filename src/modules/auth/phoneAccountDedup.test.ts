import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { testPrisma } from '../../../tests/setup.js';
import { createApp } from '@/server.js';
import { buildTestInitData } from '@/lib/telegram.js';
import { NoopNotifier } from '@/lib/notifier.js';

// One phone number = exactly one account — enforced at the DB (phone @unique)
// AND across auth methods: a phone+password account and a Telegram account for
// the same number must resolve to a single user, never two.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
let app: Express;

beforeEach(() => {
  app = createApp(testPrisma, new NoopNotifier());
});

const tgInitData = (id: number) =>
  buildTestInitData(
    { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'QQ', user: JSON.stringify({ id, first_name: 'User', language_code: 'ru' }) },
    BOT_TOKEN,
  );

async function seedOtp(phone: string, code: string): Promise<void> {
  await testPrisma.otpCode.create({
    data: { phone, codeHash: await bcrypt.hash(code, 4), expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
}

async function registerWithPassword(phone: string, password: string) {
  await seedOtp(phone, '123456');
  const res = await request(app)
    .post('/v1/auth/register')
    .send({ phone, code: '123456', name: 'Тест', surname: 'Юзер', password });
  expect(res.status).toBe(201);
  return res.body.user.id as string;
}

describe('one phone = one account', () => {
  it('the DB rejects a second user with the same phone (unique constraint)', async () => {
    const phone = '+996700300001';
    await testPrisma.user.create({ data: { phone, name: 'A', language: 'ru', roles: ['passenger'] } });
    await expect(
      testPrisma.user.create({ data: { phone, name: 'B', language: 'ru', roles: ['passenger'] } }),
    ).rejects.toThrow(); // P2002 unique violation on phone
  });

  it('registering the same phone twice is blocked (409 already_registered)', async () => {
    const phone = '+996700300002';
    await registerWithPassword(phone, 'firstpass1');
    await seedOtp(phone, '654321');
    const dup = await request(app)
      .post('/v1/auth/register')
      .send({ phone, code: '654321', name: 'Тест', surname: 'Два', password: 'secondpass1' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.reason).toBe('already_registered');
  });

  it('a password account and a Telegram account for the same phone merge into one', async () => {
    const phone = '+996700300003';

    // 1) Classical phone+password account.
    const pwUserId = await registerWithPassword(phone, 'mypass1234');

    // 2) A separate Telegram login creates a placeholder account (no phone yet).
    const tg = await request(app).post('/v1/auth/telegram').send({ initData: tgInitData(5001) });
    expect(tg.body.kind).toBe('full');
    const tgUserId = tg.body.user.id as string;
    expect(tgUserId).not.toBe(pwUserId);

    // 3) The Telegram user confirms the SAME phone → merge (must not 500 on the
    //    unique index).
    await seedOtp(phone, '300303');
    const confirm = await request(app)
      .patch('/v1/users/me/phone/confirm')
      .set('Authorization', `Bearer ${tg.body.accessToken}`)
      .send({ newPhone: phone, code: '300303' });
    expect(confirm.status).toBe(200);

    // 4) Exactly one ACTIVE user owns the phone; the placeholder is soft-deleted
    //    and the password account absorbed the telegramId.
    const active = await testPrisma.user.findMany({ where: { phone, deletedAt: null } });
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(pwUserId);
    expect(active[0]!.telegramId).toBe(5001n);
    const placeholder = await testPrisma.user.findUniqueOrThrow({ where: { id: tgUserId } });
    expect(placeholder.deletedAt).not.toBeNull();

    // 5) Both auth methods now land on that ONE account.
    const pwLogin = await request(app).post('/v1/auth/phone/login').send({ phone, password: 'mypass1234' });
    expect(pwLogin.status).toBe(200);
    expect(pwLogin.body.user.id).toBe(pwUserId);

    const tgLogin = await request(app).post('/v1/auth/telegram').send({ initData: tgInitData(5001) });
    expect(tgLogin.body.user.id).toBe(pwUserId);
  });
});
