import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { testPrisma } from '../../../tests/setup.js';
import { createApp } from '@/server.js';
import crypto from 'node:crypto';
import { clearSentMessages, getSentMessages } from '@/lib/sms.js';
import { createUser, jpegBuffer } from '../../../tests/factories.js';

let app: Express;
beforeEach(() => {
  app = createApp(testPrisma);
});

describe('GET /v1/users/me', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/v1/users/me');
    expect(res.status).toBe(401);
  });

  it('returns the caller profile when authenticated', async () => {
    const u = await createUser(testPrisma, { name: 'Asan', language: 'kg' });
    const res = await request(app)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${u.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(u.id);
    expect(res.body.name).toBe('Asan');
    expect(res.body.language).toBe('kg');
    expect(res.body.phoneVerified).toBe(true);
  });

  it('hides rating when ratingCount < 3', async () => {
    const u = await createUser(testPrisma);
    // Default ratingCount=0, rating=0 → service should mask as null
    const res = await request(app)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${u.accessToken}`);
    expect(res.body.rating).toBeNull();
  });
});

describe('PATCH /v1/users/me', () => {
  it('updates name + language + terms consent', async () => {
    const u = await createUser(testPrisma);
    const res = await request(app)
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ name: 'New Name', language: 'kg', termsAccepted: true });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    expect(res.body.language).toBe('kg');
    expect(res.body.termsAcceptedAt).not.toBeNull();
  });

  it('rejects invalid language', async () => {
    const u = await createUser(testPrisma);
    const res = await request(app)
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ language: 'en' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /v1/users/me (soft delete)', () => {
  it('nullifies PII, revokes refresh, and blocks future auth', async () => {
    const u = await createUser(testPrisma, { name: 'ToDelete' });
    const del = await request(app)
      .delete('/v1/users/me')
      .set('Authorization', `Bearer ${u.accessToken}`);
    expect(del.status).toBe(204);

    const row = await testPrisma.user.findUnique({ where: { id: u.id } });
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.name).toBe('Удалённый пользователь');
    expect(row!.phone.startsWith('+del:')).toBe(true);
    expect(row!.telegramId).toBeNull();

    // Subsequent auth check must fail — user effectively gone.
    const after = await request(app)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${u.accessToken}`);
    expect(after.status).toBe(401);

    // Refresh tokens revoked
    const tokens = await testPrisma.refreshToken.findMany({ where: { userId: u.id } });
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
  });
});

describe('GET /v1/users/:id (public)', () => {
  it('returns the public shape (no phone)', async () => {
    const target = await createUser(testPrisma, { name: 'Target' });
    const caller = await createUser(testPrisma);
    const res = await request(app)
      .get(`/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${caller.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(target.id);
    expect(res.body.name).toBe('Target');
    expect(res.body.phone).toBeUndefined();
  });

  it('404 for soft-deleted user', async () => {
    const target = await createUser(testPrisma);
    await testPrisma.user.update({
      where: { id: target.id },
      data: { deletedAt: new Date() },
    });
    const caller = await createUser(testPrisma);
    const res = await request(app)
      .get(`/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${caller.accessToken}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/users/avatar', () => {
  it('uploads a JPEG and sets avatarUrl', async () => {
    const u = await createUser(testPrisma);
    const res = await request(app)
      .post('/v1/users/avatar')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .attach('avatar', jpegBuffer(), { filename: 'me.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toMatch(/\/avatars\/\d{4}\/\d{2}\//);

    // DB stores relative path; API response returns the full URL.
    const row = await testPrisma.user.findUnique({ where: { id: u.id } });
    expect(res.body.avatarUrl).toContain(row!.avatarUrl!);
  });

  it('rejects a text/plain upload', async () => {
    const u = await createUser(testPrisma);
    const res = await request(app)
      .post('/v1/users/avatar')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .attach('avatar', Buffer.from('not an image'), {
        filename: 'x.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
  });

  it('rejects a file where MIME says JPEG but magic bytes say otherwise', async () => {
    const u = await createUser(testPrisma);
    const res = await request(app)
      .post('/v1/users/avatar')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .attach('avatar', Buffer.from('<?php echo "hi"; ?>'), {
        filename: 'x.jpg',
        contentType: 'image/jpeg',
      });
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/cities', () => {
  it('returns active cities', async () => {
    await testPrisma.city.createMany({
      data: [
        { id: 9001, nameRu: 'Бишкек', nameKg: 'Бишкек', nameEn: 'Bishkek', type: 'city', regionId: 7, regionNameRu: 'Бишкек', regionNameKg: 'Бишкек', isActive: true, prompt: [] },
        { id: 9002, nameRu: 'Архив', nameKg: 'Архив', nameEn: 'Arkhiv', type: 'village', regionId: 1, regionNameRu: 'Чуйская область', regionNameKg: 'Чүй облусу', isActive: false, prompt: [] },
      ],
    });
    const res = await request(app).get('/v1/cities');
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { nameRu: string }) => c.nameRu)).toEqual(['Бишкек']);
  });
});

describe('POST /v1/users/me/phone/send-otp — SMS-only delivery (possession proof)', () => {
  it('sends the code to the TARGET phone via SMS, never to the requester Telegram', async () => {
    clearSentMessages();
    const u = await createUser(testPrisma, { telegramId: BigInt(777001) });
    const res = await request(app)
      .post('/v1/users/me/phone/send-otp')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ phone: '+996700999888' });
    expect(res.status).toBe(200);
    const sms = getSentMessages();
    expect(sms).toHaveLength(1);
    expect(sms[0]!.phone).toBe('+996700999888');
  });
});

describe('POST /v1/users/me/phone/from-telegram (requestContact binding)', () => {
  function signContactResponse(contact: object, botToken: string): string {
    const params = new URLSearchParams();
    params.set('contact', JSON.stringify(contact));
    params.set('auth_date', String(Math.floor(Date.now() / 1000)));
    const entries: [string, string][] = [];
    params.forEach((v, k) => entries.push([k, v]));
    entries.sort(([a], [b]) => (a < b ? -1 : 1));
    const dcs = entries.map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
    return params.toString();
  }
  const BOT = process.env['TELEGRAM_BOT_TOKEN'] ?? '';

  it('binds the Telegram-verified number and returns tokens', async () => {
    const u = await createUser(testPrisma, { telegramId: BigInt(880001), phone: '+prov:contact-a' });
    const response = signContactResponse(
      { phone_number: '996700777666', user_id: 880001, first_name: 'T' },
      BOT,
    );
    const res = await request(app)
      .post('/v1/users/me/phone/from-telegram')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ response });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const fresh = await testPrisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(fresh.phone).toBe('+996700777666');
    expect(fresh.phoneVerifiedAt).not.toBeNull();
  });

  it('rejects a payload signed for a DIFFERENT telegram user', async () => {
    const u = await createUser(testPrisma, { telegramId: BigInt(880002) });
    const response = signContactResponse(
      { phone_number: '996700555444', user_id: 999999, first_name: 'X' },
      BOT,
    );
    const res = await request(app)
      .post('/v1/users/me/phone/from-telegram')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ response });
    expect(res.status).toBe(401);
    expect(res.body.error.details.reason).toBe('contact_user_mismatch');
  });

  it('rejects a tampered signature', async () => {
    const u = await createUser(testPrisma, { telegramId: BigInt(880003) });
    const response = signContactResponse(
      { phone_number: '996700333222', user_id: 880003 },
      BOT,
    ).replace(/hash=\w{8}/, 'hash=00000000');
    const res = await request(app)
      .post('/v1/users/me/phone/from-telegram')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ response });
    expect(res.status).toBe(401);
    expect(res.body.error.details.reason).toBe('contact_signature_invalid');
  });
});
