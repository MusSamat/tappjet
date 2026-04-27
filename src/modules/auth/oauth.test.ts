import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { testPrisma } from '../../../tests/setup.js';
import { createApp } from '@/server.js';
import { NoopNotifier } from '@/lib/notifier.js';

// Replace Google/Apple JWKS verifiers — no network calls in tests.
vi.mock('@/lib/oauth/google.js', () => ({
  verifyGoogleIdToken: vi.fn(),
}));
vi.mock('@/lib/oauth/apple.js', () => ({
  verifyAppleIdentityToken: vi.fn(),
}));

import { verifyGoogleIdToken } from '@/lib/oauth/google.js';
import { verifyAppleIdentityToken } from '@/lib/oauth/apple.js';

const mockGoogle = vi.mocked(verifyGoogleIdToken);
const mockApple = vi.mocked(verifyAppleIdentityToken);

let app: Express;

beforeEach(() => {
  app = createApp(testPrisma, new NoopNotifier());
  vi.clearAllMocks();
});

async function seedOtp(phone: string, code: string): Promise<void> {
  const hash = await bcrypt.hash(code, 4);
  await testPrisma.otpCode.create({
    data: { phone, codeHash: hash, expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
}

async function registerPhone(phone: string, code: string): Promise<string> {
  await seedOtp(phone, code);
  const res = await request(app).post('/v1/auth/phone/verify').send({ phone, code });
  return res.body.accessToken as string;
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────

describe('POST /v1/auth/google', () => {
  it('creates new user and returns full auth (phone not required)', async () => {
    mockGoogle.mockResolvedValueOnce({
      sub: 'g-new-001',
      email: 'aziz@example.com',
      name: 'Азиз Карим',
    });

    const res = await request(app).post('/v1/auth/google').send({ idToken: 'tok' });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('full');
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeTypeOf('string');
    expect(res.body.user.phoneVerified).toBe(false);
    expect(res.body.user.phone).toBe('');

    const provider = await testPrisma.authProvider.findUnique({
      where: { provider_providerUserId: { provider: 'google', providerUserId: 'g-new-001' } },
    });
    expect(provider).not.toBeNull();

    const user = await testPrisma.user.findUniqueOrThrow({ where: { id: provider!.userId } });
    expect(user.phoneVerifiedAt).toBeNull();
    expect(user.name).toBe('Азиз Карим');
  });

  it('returns full auth when phone is already verified', async () => {
    mockGoogle.mockResolvedValueOnce({ sub: 'g-verified-002' });
    const prov = await request(app).post('/v1/auth/google').send({ idToken: 'tok' });

    await testPrisma.user.update({
      where: { id: prov.body.user.id },
      data: { phone: '+996700000002', phoneVerifiedAt: new Date() },
    });

    mockGoogle.mockResolvedValueOnce({ sub: 'g-verified-002' });
    const res = await request(app).post('/v1/auth/google').send({ idToken: 'tok' });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('full');
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeTypeOf('string');
    expect(res.body.user.phoneVerified).toBe(true);
  });

  it('returns full auth on repeat logins without creating duplicate rows', async () => {
    mockGoogle.mockResolvedValue({ sub: 'g-repeat-003' });

    const r1 = await request(app).post('/v1/auth/google').send({ idToken: 'tok' });
    const r2 = await request(app).post('/v1/auth/google').send({ idToken: 'tok' });

    expect(r1.body.kind).toBe('full');
    expect(r2.body.kind).toBe('full');
    const count = await testPrisma.authProvider.count({
      where: { provider: 'google', providerUserId: 'g-repeat-003' },
    });
    expect(count).toBe(1);
  });

  it('returns 401 for invalid id_token', async () => {
    mockGoogle.mockRejectedValueOnce(new Error('JWT expired'));

    const res = await request(app).post('/v1/auth/google').send({ idToken: 'bad' });

    expect(res.status).toBe(401);
    expect(res.body.error.details.reason).toBe('google_invalid');
  });

  it('returns 403 when linked user is blocked', async () => {
    mockGoogle.mockResolvedValueOnce({ sub: 'g-blocked-004' });
    const prov = await request(app).post('/v1/auth/google').send({ idToken: 'tok' });

    await testPrisma.user.update({
      where: { id: prov.body.user.id },
      data: { phone: '+996700000004', phoneVerifiedAt: new Date(), isBlocked: true },
    });

    mockGoogle.mockResolvedValueOnce({ sub: 'g-blocked-004' });
    const res = await request(app).post('/v1/auth/google').send({ idToken: 'tok' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when idToken field is missing', async () => {
    const res = await request(app).post('/v1/auth/google').send({});
    expect(res.status).toBe(400);
  });

  it('uses email prefix as name when name claim is absent', async () => {
    mockGoogle.mockResolvedValueOnce({ sub: 'g-noname-005', email: 'user@gtest.com' });

    const res = await request(app).post('/v1/auth/google').send({ idToken: 'tok' });
    expect(res.status).toBe(200);

    const provider = await testPrisma.authProvider.findUniqueOrThrow({
      where: { provider_providerUserId: { provider: 'google', providerUserId: 'g-noname-005' } },
    });
    const user = await testPrisma.user.findUniqueOrThrow({ where: { id: provider.userId } });
    expect(user.name).toBe('user');
  });
});

// ─── Apple Sign-In ────────────────────────────────────────────────────────────

describe('POST /v1/auth/apple', () => {
  it('creates new user and returns full auth (phone not required)', async () => {
    mockApple.mockResolvedValueOnce({ sub: 'a-new-101', email: 'user@icloud.com' });

    const res = await request(app).post('/v1/auth/apple').send({ identityToken: 'tok' });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('full');
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.user.phoneVerified).toBe(false);
    expect(res.body.user.phone).toBe('');

    const provider = await testPrisma.authProvider.findUnique({
      where: { provider_providerUserId: { provider: 'apple', providerUserId: 'a-new-101' } },
    });
    expect(provider).not.toBeNull();

    const user = await testPrisma.user.findUniqueOrThrow({ where: { id: provider!.userId } });
    expect(user.phoneVerifiedAt).toBeNull();
  });

  it('returns full auth when phone is already verified', async () => {
    mockApple.mockResolvedValueOnce({ sub: 'a-verified-102' });
    const prov = await request(app).post('/v1/auth/apple').send({ identityToken: 'tok' });

    await testPrisma.user.update({
      where: { id: prov.body.user.id },
      data: { phone: '+996700000102', phoneVerifiedAt: new Date() },
    });

    mockApple.mockResolvedValueOnce({ sub: 'a-verified-102' });
    const res = await request(app).post('/v1/auth/apple').send({ identityToken: 'tok' });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('full');
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.user.phoneVerified).toBe(true);
  });

  it('does not create duplicate provider rows on idempotent first logins', async () => {
    mockApple.mockResolvedValue({ sub: 'a-idem-103' });

    await request(app).post('/v1/auth/apple').send({ identityToken: 'tok' });
    await request(app).post('/v1/auth/apple').send({ identityToken: 'tok' });

    const count = await testPrisma.authProvider.count({
      where: { provider: 'apple', providerUserId: 'a-idem-103' },
    });
    expect(count).toBe(1);
  });

  it('returns 401 for invalid identity_token', async () => {
    mockApple.mockRejectedValueOnce(new Error('Apple JWT verification failed'));

    const res = await request(app).post('/v1/auth/apple').send({ identityToken: 'bad' });

    expect(res.status).toBe(401);
    expect(res.body.error.details.reason).toBe('apple_invalid');
  });

  it('returns 403 when linked user is blocked', async () => {
    mockApple.mockResolvedValueOnce({ sub: 'a-blocked-104' });
    const prov = await request(app).post('/v1/auth/apple').send({ identityToken: 'tok' });

    await testPrisma.user.update({
      where: { id: prov.body.user.id },
      data: { phone: '+996700000104', phoneVerifiedAt: new Date(), isBlocked: true },
    });

    mockApple.mockResolvedValueOnce({ sub: 'a-blocked-104' });
    const res = await request(app).post('/v1/auth/apple').send({ identityToken: 'tok' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when identityToken field is missing', async () => {
    const res = await request(app).post('/v1/auth/apple').send({});
    expect(res.status).toBe(400);
  });

  it('handles private relay email (is_private_email=true) without error', async () => {
    mockApple.mockResolvedValueOnce({
      sub: 'a-private-105',
      email: 'abc123@privaterelay.appleid.com',
      is_private_email: true,
    });

    const res = await request(app).post('/v1/auth/apple').send({ identityToken: 'tok' });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('full');
  });
});

// ─── OAuth user voluntarily binds a phone ────────────────────────────────────
// Phone is not required — these tests verify the optional binding path still works.

describe('OAuth user → voluntary phone binding via /phone/verify', () => {
  it('Google user can bind a phone after full auth is already issued', async () => {
    mockGoogle.mockResolvedValueOnce({ sub: 'g-bind-201', name: 'Binder G' });
    const login = await request(app).post('/v1/auth/google').send({ idToken: 'tok' });
    expect(login.body.kind).toBe('full');

    const phone = '+996700000201';
    await seedOtp(phone, '201201');
    const res = await request(app)
      .post('/v1/auth/phone/verify')
      .send({ phone, code: '201201' });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('full');
    expect(res.body.user.phoneVerified).toBe(true);
  });

  it('Apple user can bind a phone after full auth is already issued', async () => {
    mockApple.mockResolvedValueOnce({ sub: 'a-bind-202' });
    const login = await request(app).post('/v1/auth/apple').send({ identityToken: 'tok' });
    expect(login.body.kind).toBe('full');

    const phone = '+996700000202';
    await seedOtp(phone, '202202');
    const res = await request(app)
      .post('/v1/auth/phone/verify')
      .send({ phone, code: '202202' });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('full');
  });
});

// ─── Provider link/unlink ─────────────────────────────────────────────────────

describe('POST /v1/users/me/providers — link Google / Apple', () => {
  it('links Google to an existing phone-registered user', async () => {
    const token = await registerPhone('+996700000301', '301301');
    mockGoogle.mockResolvedValueOnce({ sub: 'g-link-301', email: 'g@link.com' });

    const res = await request(app)
      .post('/v1/users/me/providers')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'google', idToken: 'tok' });

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe('google');

    const row = await testPrisma.authProvider.findUnique({
      where: { provider_providerUserId: { provider: 'google', providerUserId: 'g-link-301' } },
    });
    expect(row).not.toBeNull();
  });

  it('links Apple to an existing phone-registered user', async () => {
    const token = await registerPhone('+996700000302', '302302');
    mockApple.mockResolvedValueOnce({ sub: 'a-link-302' });

    const res = await request(app)
      .post('/v1/users/me/providers')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'apple', identityToken: 'tok' });

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe('apple');
  });

  it('returns 409 when Google account is already linked to a different user', async () => {
    const token1 = await registerPhone('+996700000303', '303303');
    const token2 = await registerPhone('+996700000304', '304304');

    mockGoogle.mockResolvedValueOnce({ sub: 'g-conflict-303' });
    await request(app)
      .post('/v1/users/me/providers')
      .set('Authorization', `Bearer ${token1}`)
      .send({ provider: 'google', idToken: 'tok' });

    mockGoogle.mockResolvedValueOnce({ sub: 'g-conflict-303' });
    const res = await request(app)
      .post('/v1/users/me/providers')
      .set('Authorization', `Bearer ${token2}`)
      .send({ provider: 'google', idToken: 'tok' });

    expect(res.status).toBe(409);
  });

  it('is idempotent — linking the same Google account twice returns 201 both times', async () => {
    const token = await registerPhone('+996700000305', '305305');
    mockGoogle.mockResolvedValue({ sub: 'g-idem-305' });

    const r1 = await request(app)
      .post('/v1/users/me/providers')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'google', idToken: 'tok' });
    const r2 = await request(app)
      .post('/v1/users/me/providers')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'google', idToken: 'tok' });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const count = await testPrisma.authProvider.count({
      where: { provider: 'google', providerUserId: 'g-idem-305' },
    });
    expect(count).toBe(1);
  });
});

describe('DELETE /v1/users/me/providers/:provider — unlink Google / Apple', () => {
  it('removes Google provider when a second provider still exists', async () => {
    const token = await registerPhone('+996700000401', '401401');
    mockGoogle.mockResolvedValueOnce({ sub: 'g-unlink-401' });
    await request(app)
      .post('/v1/users/me/providers')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'google', idToken: 'tok' });

    const res = await request(app)
      .delete('/v1/users/me/providers/google')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
    const row = await testPrisma.authProvider.findUnique({
      where: { provider_providerUserId: { provider: 'google', providerUserId: 'g-unlink-401' } },
    });
    expect(row).toBeNull();
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app).delete('/v1/users/me/providers/google');
    expect(res.status).toBe(401);
  });
});
