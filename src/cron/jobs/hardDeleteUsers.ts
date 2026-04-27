import type { Job } from '@/cron/scheduler.js';
import { logger } from '@/lib/logger.js';

// TZ §24.3 "Через 30 дней — hard delete": physically remove users soft-deleted
// strictly more than 30 days ago. Runs daily at 04:30.
// DriverProfile and all related rows cascade-delete via FK (onDelete: Cascade).
export const hardDeleteUsersJob: Job = {
  name: 'hard_delete_users',
  schedule: '30 4 * * *',
  maxRuntimeSec: 180,
  async run(prisma) {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);

    const targets = await prisma.user.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true },
    });
    if (targets.length === 0) return;

    const ids = targets.map((u) => u.id);

    // Hard delete — cascade removes all related rows (tokens, driver_profiles, etc.)
    await prisma.user.deleteMany({ where: { id: { in: ids } } });

    logger.info({ count: ids.length }, 'hard_delete_users: purged');
  },
};
