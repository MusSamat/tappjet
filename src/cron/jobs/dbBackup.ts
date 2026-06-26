import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Job } from '@/cron/scheduler.js';
import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';

const exec = promisify(execFile);

// TZ §21 db_backup — daily pg_dump at 03:00, retain BACKUP_RETENTION_DAYS days.
// (Line comment: the cron expression has no */ so a block comment is safe, but
// we keep the module's comments uniform with the other jobs.)
export const dbBackupJob: Job = {
  name: 'db_backup',
  schedule: '0 3 * * *',
  maxRuntimeSec: 1800,
  async run() {
    if (!env.BACKUP_DIR) {
      logger.warn('db_backup skipped — BACKUP_DIR not configured');
      return;
    }
    const dir = path.join(env.BACKUP_DIR, 'db');
    await fs.mkdir(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `pg-${stamp}.dump`);
    // Custom-format dump (-Fc): compressed and restorable via pg_restore.
    await exec('pg_dump', ['-Fc', '--dbname', env.DATABASE_URL, '-f', file]);

    await pruneOld(dir, env.BACKUP_RETENTION_DAYS);
    logger.info({ file }, 'db_backup complete');
  },
};

/** Delete dump files older than the retention window. */
async function pruneOld(dir: string, retentionDays: number): Promise<void> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60_000;
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    entries.map(async (name) => {
      const full = path.join(dir, name);
      const stat = await fs.stat(full).catch(() => null);
      if (stat && stat.isFile() && stat.mtimeMs < cutoff) {
        await fs.unlink(full).catch(() => undefined);
      }
    }),
  );
}
