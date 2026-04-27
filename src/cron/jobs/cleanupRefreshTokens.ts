import type { Job } from '@/cron/scheduler.js';

/**
 * TZ §21 "cleanup_expired_refresh · 0 4 * * * · DELETE FROM refresh_tokens WHERE expires_at < NOW() - 1 day"
 */
export const cleanupExpiredRefreshJob: Job = {
  name: 'cleanup_expired_refresh',
  schedule: '0 4 * * *',
  maxRuntimeSec: 60,
  async run(prisma) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
    await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  },
};
