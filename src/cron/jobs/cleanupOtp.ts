import type { Job } from '@/cron/scheduler.js';

// TZ §21 cleanup_expired_otp — runs every 6 hours, deletes OTP rows expired more
// than 24h ago. (Kept as a line comment: the cron expression "0 */6 * * *"
// contains */ which would close a block comment.)
export const cleanupExpiredOtpJob: Job = {
  name: 'cleanup_expired_otp',
  schedule: '0 */6 * * *',
  maxRuntimeSec: 60,
  async run(prisma) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
    await prisma.otpCode.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  },
};
