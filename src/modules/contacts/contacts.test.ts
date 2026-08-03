import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { testPrisma } from '../../../tests/setup.js';
import { createApp } from '@/server.js';
import { createUser, createVerifiedDriver, createTrip, seedLaunchCities } from '../../../tests/factories.js';

// Phone reveal («Позвонить») — POST /v1/trips/:id/contact and
// /v1/passenger-requests/:id/contact. Call-first (no booking needed), audited,
// and daily-limited (DAILY_REVEAL_LIMIT = 30) to stop scrapers. Covers the
// happy path, self-reveal guard, not-found, and the anti-scrape rate limit.

let app: Express;
beforeEach(async () => {
  app = createApp(testPrisma);
  await seedLaunchCities(testPrisma);
});

describe('POST /v1/trips/:id/contact — reveal driver phone', () => {
  it('reveals the driver phone and writes an audit row', async () => {
    const driver = await createVerifiedDriver(testPrisma, { plate: 'C1' });
    const trip = await createTrip(testPrisma, driver.id);
    const viewer = await createUser(testPrisma);

    const res = await request(app)
      .post(`/v1/trips/${trip.id}/contact`)
      .set('Authorization', `Bearer ${viewer.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.phone).toBe(driver.phone);
    const reveals = await testPrisma.contactReveal.count({ where: { viewerId: viewer.id } });
    expect(reveals).toBe(1);
  });

  it('rejects revealing your own trip (400 own_trip)', async () => {
    const driver = await createVerifiedDriver(testPrisma, { plate: 'C2' });
    const trip = await createTrip(testPrisma, driver.id);
    const res = await request(app)
      .post(`/v1/trips/${trip.id}/contact`)
      .set('Authorization', `Bearer ${driver.accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.details.reason).toBe('own_trip');
  });

  it('404 for a non-existent trip', async () => {
    const viewer = await createUser(testPrisma);
    const res = await request(app)
      .post(`/v1/trips/${'0'.repeat(8)}-0000-0000-0000-000000000000/contact`)
      .set('Authorization', `Bearer ${viewer.accessToken}`);
    expect(res.status).toBe(404);
  });

  it('enforces the daily reveal limit (429 after 30 reveals)', async () => {
    const driver = await createVerifiedDriver(testPrisma, { plate: 'C3' });
    const trip = await createTrip(testPrisma, driver.id);
    const viewer = await createUser(testPrisma);

    // Pre-seed 30 reveals in the last 24h → the next one trips the limit.
    await testPrisma.contactReveal.createMany({
      data: Array.from({ length: 30 }, () => ({
        viewerId: viewer.id,
        targetUserId: driver.id,
        contextType: 'trip',
        contextId: trip.id,
      })),
    });

    const res = await request(app)
      .post(`/v1/trips/${trip.id}/contact`)
      .set('Authorization', `Bearer ${viewer.accessToken}`);
    expect(res.status).toBe(429);
    expect(res.body.error.details.reason).toBe('contact_reveal_daily_limit');
  });

  it('requires authentication (401)', async () => {
    const driver = await createVerifiedDriver(testPrisma, { plate: 'C4' });
    const trip = await createTrip(testPrisma, driver.id);
    const res = await request(app).post(`/v1/trips/${trip.id}/contact`);
    expect(res.status).toBe(401);
  });
});
