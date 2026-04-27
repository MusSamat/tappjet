import cron from 'node-cron';
import os from 'node:os';
import type { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger.js';

/**
 * Cron scheduler with distributed locks, per TZ §21.1:
 *   "Для предотвращения двойного выполнения при нескольких инстансах —
 *    перед каждой задачей INSERT в таблицу cron_locks с UNIQUE ограничением."
 *
 * Pattern: take the lock with an UPSERT that only succeeds if the existing
 * row is expired. Release by deleting the row at the end. If the job
 * crashes, lockedUntil expires and the next run recovers.
 */

export interface Job {
  name: string;
  schedule: string;       // cron expression
  maxRuntimeSec: number;  // lock TTL — pick > typical runtime
  run(prisma: PrismaClient): Promise<void>;
}

const INSTANCE_ID = `${os.hostname()}#${process.pid}`;

async function acquire(prisma: PrismaClient, job: Job): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + job.maxRuntimeSec * 1000);

  // Atomic: upsert if (a) no row yet or (b) existing lock already expired.
  // Prisma has no "upsert where" clause, so we use a raw parametrised INSERT
  // ... ON CONFLICT DO UPDATE with a WHERE predicate.
  const result = await prisma.$executeRaw`
    INSERT INTO cron_locks (job_name, locked_at, locked_until, locked_by)
    VALUES (${job.name}, ${now}, ${until}, ${INSTANCE_ID})
    ON CONFLICT (job_name) DO UPDATE
      SET locked_at = EXCLUDED.locked_at,
          locked_until = EXCLUDED.locked_until,
          locked_by = EXCLUDED.locked_by
      WHERE cron_locks.locked_until < ${now}
  `;
  return result > 0;
}

async function release(prisma: PrismaClient, jobName: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM cron_locks
    WHERE job_name = ${jobName} AND locked_by = ${INSTANCE_ID}
  `;
}

export class CronScheduler {
  private tasks: cron.ScheduledTask[] = [];

  constructor(private readonly prisma: PrismaClient) {}

  register(job: Job): void {
    const task = cron.schedule(
      job.schedule,
      async () => {
        const acquired = await acquire(this.prisma, job).catch((err) => {
          logger.error({ err, job: job.name }, 'cron lock error');
          return false;
        });
        if (!acquired) {
          logger.debug({ job: job.name }, 'cron skipped — another instance holds lock');
          return;
        }
        const start = Date.now();
        try {
          await job.run(this.prisma);
          logger.info(
            { job: job.name, duration_ms: Date.now() - start },
            'cron job done',
          );
        } catch (err) {
          logger.error({ err, job: job.name }, 'cron job failed');
        } finally {
          await release(this.prisma, job.name).catch((err) =>
            logger.error({ err, job: job.name }, 'cron release error'),
          );
        }
      },
      { scheduled: false },
    );
    this.tasks.push(task);
    logger.debug({ job: job.name, schedule: job.schedule }, 'cron registered');
  }

  start(): void {
    this.tasks.forEach((t) => t.start());
    logger.info({ count: this.tasks.length }, 'cron scheduler started');
  }

  async stop(): Promise<void> {
    await Promise.all(this.tasks.map((t) => t.stop()));
    logger.info('cron scheduler stopped');
  }
}
