import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Job } from '@/cron/scheduler.js';
import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';

const exec = promisify(execFile);

// Ensure a single trailing slash so rsync copies directory *contents*.
const withSlash = (p: string): string => p.replace(/\/?$/, '/');

// TZ §21 files_backup — daily rsync of the uploads dir at 04:00.
export const filesBackupJob: Job = {
  name: 'files_backup',
  schedule: '0 4 * * *',
  maxRuntimeSec: 1800,
  async run() {
    if (!env.BACKUP_DIR) {
      logger.warn('files_backup skipped — BACKUP_DIR not configured');
      return;
    }
    const dest = path.join(env.BACKUP_DIR, 'files');
    await fs.mkdir(dest, { recursive: true });
    // -a archive (perms/times), --delete mirrors removals on the backup side.
    await exec('rsync', ['-a', '--delete', withSlash(env.FILES_DIR), withSlash(dest)]);
    logger.info({ dest }, 'files_backup complete');
  },
};
