import { beforeEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { testPrisma } from './setup.js';
import { createApp } from '@/server.js';
import { createEngagementService } from '@/lib/engagement.js';
import { createUser, createVerifiedDriver, createTrip } from './factories.js';

let app: Express;
beforeEach(() => {
  app = createApp(testPrisma);
});

async function tripViews(id: string): Promise<number> {
  const t = await testPrisma.trip.findUniqueOrThrow({ where: { id }, select: { viewsCount: true } });
  return t.viewsCount;
}

// recordView is fire-and-forget on the HTTP path — poll until it lands.
async function waitTripViews(id: string, expected: number, tries = 40): Promise<number> {
  for (let i = 0; i < tries; i++) {
    const v = await tripViews(id);
    if (v >= expected) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  return tripViews(id);
}

describe('engagement service (unit)', () => {
  it('recordView increments for others/anon but skips the owner self-view', async () => {
    const driver = await createVerifiedDriver(testPrisma);
    const trip = await createTrip(testPrisma, driver.id);
    const eng = createEngagementService(testPrisma);

    await eng.recordView('trip', trip.id, driver.id, driver.id); // owner → skip
    expect(await tripViews(trip.id)).toBe(0);

    const other = await createUser(testPrisma);
    await eng.recordView('trip', trip.id, null, driver.id); // anonymous → count
    await eng.recordView('trip', trip.id, other.id, driver.id); // other user → count
    expect(await tripViews(trip.id)).toBe(2);
  });

  it('like is a toggle, idempotent, and keeps likes_count consistent', async () => {
    const driver = await createVerifiedDriver(testPrisma);
    const trip = await createTrip(testPrisma, driver.id);
    const u = await createUser(testPrisma);
    const eng = createEngagementService(testPrisma);

    expect(await eng.like('trip', trip.id, u.id)).toBe(true);
    expect(await eng.like('trip', trip.id, u.id)).toBe(false); // second like = no-op
    expect(await eng.isLiked('trip', trip.id, u.id)).toBe(true);
    expect(
      (await testPrisma.trip.findUniqueOrThrow({ where: { id: trip.id }, select: { likesCount: true } })).likesCount,
    ).toBe(1);

    expect(await eng.unlike('trip', trip.id, u.id)).toBe(true);
    expect(await eng.unlike('trip', trip.id, u.id)).toBe(false); // already gone
    expect(
      (await testPrisma.trip.findUniqueOrThrow({ where: { id: trip.id }, select: { likesCount: true } })).likesCount,
    ).toBe(0);
  });
});

describe('trip engagement (HTTP)', () => {
  it('like endpoint toggles; detail shows liked for the liker but metrics only for the owner', async () => {
    const driver = await createVerifiedDriver(testPrisma);
    const trip = await createTrip(testPrisma, driver.id);
    const liker = await createUser(testPrisma);

    await request(app)
      .post(`/v1/trips/${trip.id}/like`)
      .set('Authorization', `Bearer ${liker.accessToken}`)
      .expect(200, { liked: true });

    const asLiker = await request(app)
      .get(`/v1/trips/${trip.id}`)
      .set('Authorization', `Bearer ${liker.accessToken}`)
      .expect(200);
    expect(asLiker.body.liked).toBe(true);
    expect(asLiker.body.metrics).toBeNull(); // not the owner → no numbers

    const asOwner = await request(app)
      .get(`/v1/trips/${trip.id}`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .expect(200);
    expect(asOwner.body.metrics.likes).toBe(1);
    expect(asOwner.body.liked).toBe(false);

    await request(app)
      .delete(`/v1/trips/${trip.id}/like`)
      .set('Authorization', `Bearer ${liker.accessToken}`)
      .expect(200, { liked: false });
  });

  it('anonymous GET detail increments the view counter', async () => {
    const driver = await createVerifiedDriver(testPrisma);
    const trip = await createTrip(testPrisma, driver.id);
    await request(app).get(`/v1/trips/${trip.id}`).expect(200);
    expect(await waitTripViews(trip.id, 1)).toBe(1);
  });
});

describe('passenger-request engagement (HTTP, polymorphic)', () => {
  it('like toggles and owner sees likes in metrics', async () => {
    const passenger = await createUser(testPrisma);
    const pr = await testPrisma.passengerRequest.create({
      data: {
        passengerId: passenger.id,
        originCity: 'Бишкек',
        destinationCity: 'Ош',
        seatsNeeded: 1,
        departureDate: new Date(Date.now() + 24 * 60 * 60_000),
      },
    });
    const driver = await createUser(testPrisma, { roles: ['passenger', 'driver'] });

    await request(app)
      .post(`/v1/passenger-requests/${pr.id}/like`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .expect(200, { liked: true });

    const asOwner = await request(app)
      .get(`/v1/passenger-requests/${pr.id}`)
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .expect(200);
    expect(asOwner.body.metrics.likes).toBe(1);
    expect(asOwner.body.liked).toBe(false);
  });
});
