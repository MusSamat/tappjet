import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { testPrisma } from './setup.js';
import { createApp } from '@/server.js';
import { createUser, createVerifiedDriver, createTrip, seedLaunchCities, makeNotifier } from './factories.js';

// Chaos / fault-injection — the system must degrade gracefully, not crash or
// leave inconsistent state, when a dependency fails.

let app: Express;
beforeEach(async () => {
  app = createApp(testPrisma);
  await seedLaunchCities(testPrisma);
});

describe('chaos — database failure', () => {
  it('a DB error mid-request degrades to a clean 500 INTERNAL_ERROR (no crash, no leaked internals)', async () => {
    const caller = await createUser(testPrisma);
    const spy = vi
      .spyOn(testPrisma.trip, 'findMany')
      .mockRejectedValueOnce(new Error('connection terminated unexpectedly'));

    const res = await request(app)
      .get('/v1/trips?from_city=Бишкек&to_city=Ош')
      .set('Authorization', `Bearer ${caller.accessToken}`);

    // Graceful degradation: the standard error envelope, not an unhandled crash.
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    // The raw DB error text is not echoed to the client.
    expect(res.body.error.message ?? '').not.toContain('connection terminated');
    spy.mockRestore();
  });
});

describe('chaos — notifier fault isolation', () => {
  it('a failing push notifier does NOT fail the booking (it is already committed)', async () => {
    const notifier = makeNotifier({
      bookingNewRequest: async () => {
        throw new Error('push service down');
      },
    });
    const isolatedApp = createApp(testPrisma, notifier);

    const driver = await createVerifiedDriver(testPrisma, { plate: 'CHA1' });
    const trip = await createTrip(testPrisma, driver.id);
    const passenger = await createUser(testPrisma);

    const res = await request(isolatedApp)
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${passenger.accessToken}`)
      .send({ tripId: trip.id, seatsCount: 1 });

    expect(res.status).toBe(201); // booking succeeds despite the push failure
    const count = await testPrisma.booking.count({
      where: { tripId: trip.id, passengerId: passenger.id },
    });
    expect(count).toBe(1); // and it really persisted
  });
});
