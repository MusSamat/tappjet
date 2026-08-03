/**
 * Load / throughput benchmark for the hot read path (trip search).
 *
 *   npm run test:load
 *
 * Boots the API in-process against DATABASE_URL, seeds the two launch cities so
 * the search is valid, then hammers GET /v1/trips with autocannon and prints
 * req/sec + latency percentiles. Exits non-zero if any request is non-2xx or
 * errors — so it can gate a release if throughput regresses.
 *
 * Tune with env: LOAD_CONNECTIONS (default 50), LOAD_DURATION seconds (default 10).
 */
import http from 'node:http';
import autocannon from 'autocannon';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/server.js';

const CITIES = [
  { id: 1, nameRu: 'Бишкек', nameKg: 'Бишкек', nameEn: 'Bishkek', regionId: 7, regionNameRu: 'Бишкек', regionNameKg: 'Бишкек' },
  { id: 4, nameRu: 'Ош', nameKg: 'Ош', nameEn: 'Osh', regionId: 8, regionNameRu: 'Ош', regionNameKg: 'Ош' },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  for (const c of CITIES) {
    await prisma.city.upsert({
      where: { id: c.id },
      update: { isActive: true },
      create: { ...c, type: 'city', isActive: true, prompt: [] },
    });
  }

  const server = http.createServer(createApp(prisma));
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const url = `http://localhost:${port}/v1/trips?from_city=${encodeURIComponent('Бишкек')}&to_city=${encodeURIComponent('Ош')}`;

  const connections = Number(process.env.LOAD_CONNECTIONS ?? 50);
  const duration = Number(process.env.LOAD_DURATION ?? 10);
  console.log(`\nLoad test: GET /v1/trips (Бишкек→Ош) · ${connections} conns · ${duration}s\n`);

  const result = await autocannon({ url, connections, duration });
  console.log(autocannon.printResult(result));

  await prisma.$disconnect();
  await new Promise<void>((r) => server.close(() => r()));

  const failed = result.non2xx + result.errors + result.timeouts;
  console.log(failed === 0 ? '✓ all responses 2xx' : `✗ ${failed} failed responses`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
