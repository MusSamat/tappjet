import { describe, expect, it } from 'vitest';
import { testPrisma } from '../../../tests/setup.js';
import { escalateComplaintsJob } from './escalateComplaints.js';
import { createAdmin, createUser } from '../../../tests/factories.js';

describe('escalate_complaints cron', () => {
  it('marks P0 complaints stale > 1h as escalated; fresh ones untouched', async () => {
    await createAdmin(testPrisma, { role: 'superadmin' });
    const reporter = await createUser(testPrisma);

    const stale = await testPrisma.complaint.create({
      data: {
        reporterId: reporter.id,
        category: 'safety',
        description: 'old',
        status: 'new',
        createdAt: new Date(Date.now() - 3 * 60 * 60_000), // 3h ago
      },
    });
    const fresh = await testPrisma.complaint.create({
      data: {
        reporterId: reporter.id,
        category: 'safety',
        description: 'fresh',
        status: 'new',
      },
    });
    // Non-P0 should never be touched.
    const nonP0 = await testPrisma.complaint.create({
      data: {
        reporterId: reporter.id,
        category: 'other',
        description: 'unimportant',
        status: 'new',
        createdAt: new Date(Date.now() - 3 * 60 * 60_000),
      },
    });

    await escalateComplaintsJob.run(testPrisma);

    const staleAfter = await testPrisma.complaint.findUniqueOrThrow({ where: { id: stale.id } });
    const freshAfter = await testPrisma.complaint.findUniqueOrThrow({ where: { id: fresh.id } });
    const nonP0After = await testPrisma.complaint.findUniqueOrThrow({ where: { id: nonP0.id } });
    expect(staleAfter.escalatedAt).not.toBeNull();
    expect(freshAfter.escalatedAt).toBeNull();
    expect(nonP0After.escalatedAt).toBeNull();
  });

  it('does not re-escalate an already-escalated complaint', async () => {
    const reporter = await createUser(testPrisma);
    const stamp = new Date(Date.now() - 90 * 60_000);
    const c = await testPrisma.complaint.create({
      data: {
        reporterId: reporter.id,
        category: 'safety',
        description: 'already handled',
        status: 'new',
        createdAt: new Date(Date.now() - 3 * 60 * 60_000),
        escalatedAt: stamp,
      },
    });
    await escalateComplaintsJob.run(testPrisma);
    const after = await testPrisma.complaint.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.escalatedAt!.getTime()).toBe(stamp.getTime());
  });
});
