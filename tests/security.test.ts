import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { testPrisma } from './setup.js';
import { createApp } from '@/server.js';
import { createUser, createVerifiedDriver, createTrip, seedLaunchCities } from './factories.js';
import { isAllowedOrigin } from '@/lib/cors.js';

let app: Express;
beforeEach(async () => {
  app = createApp(testPrisma);
  await seedLaunchCities(testPrisma);
});

// #13 — SQL injection. Every query goes through Prisma (parameterized), so an
// injection payload is just a literal string: it can't alter the query, dump
// the table, or 500 the server.
describe('#13 SQL injection', () => {
  it("a classic ' OR '1'='1 payload in the search is a literal, not SQL", async () => {
    const driver = await createVerifiedDriver(testPrisma, { plate: 'SEC1' });
    await createTrip(testPrisma, driver.id); // a real trip exists in the table
    const caller = await createUser(testPrisma);

    const res = await request(app)
      .get(`/v1/trips?from_city=${encodeURIComponent("' OR '1'='1")}&to_city=Ош`)
      .set('Authorization', `Bearer ${caller.accessToken}`);

    // Rejected as an unknown city — never 500, and it does NOT dump the table.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // Data intact — nothing dropped or leaked.
    expect(await testPrisma.trip.count()).toBe(1);
  });

  it('injection in a UUID path param is rejected by validation, not executed', async () => {
    const caller = await createUser(testPrisma);
    const res = await request(app)
      .get(`/v1/trips/${encodeURIComponent("1'; DROP TABLE trips;--")}`)
      .set('Authorization', `Bearer ${caller.accessToken}`);
    expect(res.status).toBe(400);
    expect(await testPrisma.trip.count()).toBe(0); // table still there
  });
});

// #17 — CORS. Only whitelisted browser origins may call the API from a page.
describe('#17 CORS', () => {
  it('allows a whitelisted origin, rejects a foreign site (unit)', () => {
    expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedOrigin('http://hack.com')).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(true); // same-origin / server-to-server
  });

  it('reflects Access-Control-Allow-Origin only for an allowed origin', async () => {
    const ok = await request(app).get('/health').set('Origin', 'http://localhost:3000');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const evil = await request(app).get('/health').set('Origin', 'http://hack.com');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});
