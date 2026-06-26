import { describe, expect, it } from 'vitest';
import { testPrisma } from '../../../tests/setup.js';
import { dbBackupJob } from './dbBackup.js';
import { filesBackupJob } from './filesBackup.js';

// In the test environment BACKUP_DIR is unset (default ''), so both jobs must
// take the no-op guard path and never shell out to pg_dump/rsync.
describe('backup cron jobs', () => {
  it('db_backup no-ops without throwing when BACKUP_DIR is not configured', async () => {
    await expect(dbBackupJob.run(testPrisma)).resolves.toBeUndefined();
  });

  it('files_backup no-ops without throwing when BACKUP_DIR is not configured', async () => {
    await expect(filesBackupJob.run(testPrisma)).resolves.toBeUndefined();
  });

  it('are registered with daily schedules and a generous lock TTL', () => {
    expect(dbBackupJob.name).toBe('db_backup');
    expect(dbBackupJob.schedule).toBe('0 3 * * *');
    expect(filesBackupJob.name).toBe('files_backup');
    expect(filesBackupJob.schedule).toBe('0 4 * * *');
    expect(dbBackupJob.maxRuntimeSec).toBeGreaterThanOrEqual(600);
  });
});
