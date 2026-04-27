import { PrismaClient } from '@prisma/client';
import { env, isTest } from '@/config/env.js';
import { logger } from '@/lib/logger.js';

// Lazily initialised singleton so test suites can swap the connection string
// before the client is created.

let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!client) {
    const url = isTest && env.TEST_DATABASE_URL ? env.TEST_DATABASE_URL : env.DATABASE_URL;
    client = new PrismaClient({
      datasources: { db: { url } },
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).$on('warn', (e: { message: string }) => logger.warn({ prisma: e }, 'prisma'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).$on('error', (e: { message: string }) => logger.error({ prisma: e }, 'prisma'));
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
