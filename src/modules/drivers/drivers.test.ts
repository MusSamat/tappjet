import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { testPrisma } from '../../../tests/setup.js';
import { createApp } from '@/server.js';
import { createUser, jpegBuffer, smallJpegBuffer } from '../../../tests/factories.js';

let app: Express;
beforeEach(() => {
  app = createApp(testPrisma);
});

async function submit(
  accessToken: string,
  overrides: Partial<{
    carPlate: string;
    carYear: string;
    seatsCount: string;
  }> = {},
) {
  return request(app)
    .post('/v1/drivers/verification')
    .set('Authorization', `Bearer ${accessToken}`)
    .field('carMake', 'Toyota')
    .field('carModel', 'Camry')
    .field('carYear', overrides.carYear ?? '2015')
    .field('carColor', 'Белый')
    .field('carPlate', overrides.carPlate ?? 'B1234AB')
    .field('seatsCount', overrides.seatsCount ?? '4')
    .attach('license', jpegBuffer(), { filename: 'l.jpg', contentType: 'image/jpeg' })
    .attach('car_passport', jpegBuffer(), { filename: 'p.jpg', contentType: 'image/jpeg' })
    .attach('car_photo', jpegBuffer(), { filename: 'c.jpg', contentType: 'image/jpeg' })
    .attach('selfie', jpegBuffer(), { filename: 's.jpg', contentType: 'image/jpeg' });
}

describe('POST /v1/drivers/verification', () => {
  it('creates a pending driver_profile with all 4 photo paths', async () => {
    const u = await createUser(testPrisma);
    const res = await submit(u.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');

    const dp = await testPrisma.driverProfile.findUnique({ where: { userId: u.id } });
    expect(dp).not.toBeNull();
    expect(dp!.verificationStatus).toBe('pending');
    expect(dp!.licensePhotoPath).toMatch(/^driver_license\//);
    expect(dp!.selfiePath).toMatch(/^selfie\//);
  });

  it('rejects a document photo below 800×600 — TZ §9.1', async () => {
    const u = await createUser(testPrisma);
    const res = await request(app)
      .post('/v1/drivers/verification')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .field('carMake', 'Toyota')
      .field('carModel', 'Camry')
      .field('carYear', '2015')
      .field('carColor', 'Белый')
      .field('carPlate', 'SMALL123')
      .field('seatsCount', '4')
      .attach('license', smallJpegBuffer(), { filename: 'l.jpg', contentType: 'image/jpeg' })
      .attach('car_passport', jpegBuffer(), { filename: 'p.jpg', contentType: 'image/jpeg' })
      .attach('car_photo', jpegBuffer(), { filename: 'c.jpg', contentType: 'image/jpeg' })
      .attach('selfie', jpegBuffer(), { filename: 's.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.reason).toBe('image_too_small');
    // No profile row should have been created.
    expect(await testPrisma.driverProfile.findUnique({ where: { userId: u.id } })).toBeNull();
  });

  it('rejects duplicate plate from another user', async () => {
    const a = await createUser(testPrisma);
    const b = await createUser(testPrisma);
    const first = await submit(a.accessToken, { carPlate: 'DUPE1234' });
    expect(first.status).toBe(201);
    const second = await submit(b.accessToken, { carPlate: 'DUPE1234' });
    expect(second.status).toBe(409);
    expect(second.body.error.details.reason).toBe('plate_taken');
  });

  it('rejects car year outside 1980..current+1', async () => {
    const u = await createUser(testPrisma);
    const res = await submit(u.accessToken, { carYear: '1950' });
    expect(res.status).toBe(400);
  });

  it('rejects seats count > 7', async () => {
    const u = await createUser(testPrisma);
    const res = await submit(u.accessToken, { seatsCount: '12' });
    expect(res.status).toBe(400);
  });

  it('rejects when car_photo is missing', async () => {
    const u = await createUser(testPrisma);
    const res = await request(app)
      .post('/v1/drivers/verification')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .field('carMake', 'Honda')
      .field('carModel', 'Civic')
      .field('carYear', '2018')
      .field('carColor', 'Чёрный')
      .field('carPlate', 'C4444AA')
      .field('seatsCount', '4')
      .attach('license', jpegBuffer(), { filename: 'l.jpg', contentType: 'image/jpeg' })
      .attach('car_passport', jpegBuffer(), { filename: 'p.jpg', contentType: 'image/jpeg' })
      .attach('selfie', jpegBuffer(), { filename: 's.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe('car_photo');
  });
});

describe('GET /v1/drivers/verification/status', () => {
  it('returns "none" when no profile exists', async () => {
    const u = await createUser(testPrisma);
    const res = await request(app)
      .get('/v1/drivers/verification/status')
      .set('Authorization', `Bearer ${u.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('none');
    expect(res.body.car).toBeNull();
  });

  it('returns full profile after submission', async () => {
    const u = await createUser(testPrisma);
    await submit(u.accessToken, { carPlate: 'ST1234' });
    const res = await request(app)
      .get('/v1/drivers/verification/status')
      .set('Authorization', `Bearer ${u.accessToken}`);
    expect(res.body.status).toBe('pending');
    expect(res.body.car.plate).toBe('ST1234');
  });
});

describe('POST /v1/drivers/verification/upload (after docs_requested)', () => {
  it('allows re-upload only for requested categories; flips status when list empties', async () => {
    const u = await createUser(testPrisma);
    await submit(u.accessToken, { carPlate: 'RE1234' });

    // Simulate admin flipping to docs_requested
    await testPrisma.driverProfile.update({
      where: { userId: u.id },
      data: {
        verificationStatus: 'docs_requested',
        requestedDocs: { set: ['license'] },
      },
    });

    // Wrong category — 400
    const wrong = await request(app)
      .post('/v1/drivers/verification/upload?category=selfie')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .attach('file', jpegBuffer(), { filename: 's.jpg', contentType: 'image/jpeg' });
    expect(wrong.status).toBe(400);

    // Right category — 200, status flips back to pending because list became empty
    const ok = await request(app)
      .post('/v1/drivers/verification/upload?category=license')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .attach('file', jpegBuffer(), { filename: 'l.jpg', contentType: 'image/jpeg' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('pending');

    const dp = await testPrisma.driverProfile.findUnique({ where: { userId: u.id } });
    expect(dp!.verificationStatus).toBe('pending');
    expect(dp!.requestedDocs).toEqual([]);
  });

  it('rejects re-upload when not in docs_requested state', async () => {
    const u = await createUser(testPrisma);
    await submit(u.accessToken);
    const res = await request(app)
      .post('/v1/drivers/verification/upload?category=license')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .attach('file', jpegBuffer(), { filename: 'l.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(409);
  });
});

describe('GET /v1/drivers/me/stats', () => {
  it('403 for users without the driver role', async () => {
    const u = await createUser(testPrisma);
    const res = await request(app)
      .get('/v1/drivers/me/stats')
      .set('Authorization', `Bearer ${u.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('returns totals for verified driver', async () => {
    const u = await createUser(testPrisma, { roles: ['passenger', 'driver'] });
    await submit(u.accessToken, { carPlate: 'ST0001' });
    await testPrisma.driverProfile.update({
      where: { userId: u.id },
      data: { verificationStatus: 'verified', totalTrips: 12, cancellations30d: 1 },
    });

    const res = await request(app)
      .get('/v1/drivers/me/stats')
      .set('Authorization', `Bearer ${u.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.totalTrips).toBe(12);
    expect(res.body.cancellations30d).toBe(1);
  });
});
