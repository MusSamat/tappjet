import { beforeEach, describe, expect, it } from 'vitest';
import { testPrisma } from '../../../tests/setup.js';
import { hardDeleteUsersJob } from './hardDeleteUsers.js';
import { createUser, createVerifiedDriver } from '../../../tests/factories.js';

describe('hard_delete_users cron', () => {
  beforeEach(() => {
    // setup.ts truncates between tests
  });

  it('hard-deletes users soft-deleted more than 30 days ago', async () => {
    // 31 days ago — should be deleted
    const old = await createUser(testPrisma);
    await testPrisma.user.update({
      where: { id: old.id },
      data:  { deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) },
    });

    // 29 days ago — should be kept
    const recent = await createUser(testPrisma);
    await testPrisma.user.update({
      where: { id: recent.id },
      data:  { deletedAt: new Date(Date.now() - 29 * 24 * 60 * 60_000) },
    });

    // Not soft-deleted — should be kept
    const active = await createUser(testPrisma);

    await hardDeleteUsersJob.run(testPrisma);

    const remaining = await testPrisma.user.findMany({ select: { id: true } });
    const ids = remaining.map((u) => u.id);
    expect(ids).not.toContain(old.id);
    expect(ids).toContain(recent.id);
    expect(ids).toContain(active.id);
  });

  it('cascade-deletes driver profile rows alongside the user', async () => {
    const driver = await createVerifiedDriver(testPrisma, { plate: 'HD001' });
    await testPrisma.user.update({
      where: { id: driver.id },
      data:  { deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) },
    });

    await hardDeleteUsersJob.run(testPrisma);

    expect(await testPrisma.user.count({ where: { id: driver.id } })).toBe(0);
    expect(await testPrisma.driverProfile.count({ where: { userId: driver.id } })).toBe(0);
  });

  it('cascades deletion to refresh tokens and related rows', async () => {
    const u = await createUser(testPrisma);
    await testPrisma.user.update({
      where: { id: u.id },
      data:  { deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) },
    });

    // Verify token exists
    const tokensBefore = await testPrisma.refreshToken.count({ where: { userId: u.id } });
    expect(tokensBefore).toBe(1);

    await hardDeleteUsersJob.run(testPrisma);

    expect(await testPrisma.user.count({ where: { id: u.id } })).toBe(0);
    expect(await testPrisma.refreshToken.count({ where: { userId: u.id } })).toBe(0);
  });

  it('handles multiple users at the cutoff boundary correctly', async () => {
    // 30 days minus 1 hour → inside window, should NOT be deleted
    const borderline = await createUser(testPrisma);
    await testPrisma.user.update({
      where: { id: borderline.id },
      data:  { deletedAt: new Date(Date.now() - 30 * 24 * 60 * 60_000 + 60 * 60_000) },
    });

    await hardDeleteUsersJob.run(testPrisma);

    expect(await testPrisma.user.count({ where: { id: borderline.id } })).toBe(1);
  });

  it('is a no-op when no users are due for deletion', async () => {
    const u = await createUser(testPrisma);
    // Active user, no deletedAt
    await expect(hardDeleteUsersJob.run(testPrisma)).resolves.toBeUndefined();
    expect(await testPrisma.user.count({ where: { id: u.id } })).toBe(1);
  });

  it('is a no-op when table is empty', async () => {
    await expect(hardDeleteUsersJob.run(testPrisma)).resolves.toBeUndefined();
  });
});
