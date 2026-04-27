import type { Job } from '@/cron/scheduler.js';
import { logger } from '@/lib/logger.js';

// TZ §21 recalc_cancellations_30d: nightly at 03:00, recalculate the rolling
// 30-day cancellation counter on every driver_profile. Used to trigger the
// "5+ cancellations in 30 days → block new trip publication" rule (§16.1).
export const recalcCancellationsJob: Job = {
  name: 'recalc_cancellations_30d',
  schedule: '0 3 * * *',
  maxRuntimeSec: 120,
  async run(prisma) {
    const result = await prisma.$executeRaw`
      UPDATE driver_profiles dp
      SET cancellations_30d = (
        SELECT COUNT(*)
        FROM bookings b
        JOIN trips t ON t.id = b.trip_id
        WHERE t.driver_id = dp.user_id
          AND b.status = 'cancelled_by_driver'
          AND b.cancelled_at >= NOW() - INTERVAL '30 days'
      )
    `;
    logger.info({ updated: result }, 'recalc_cancellations_30d: done');
  },
};
