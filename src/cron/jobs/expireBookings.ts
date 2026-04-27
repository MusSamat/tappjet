import type { Job } from '@/cron/scheduler.js';
import { logger } from '@/lib/logger.js';

// TZ §21 expire_bookings: every minute, flip pending bookings whose expires_at
// has passed to status='expired'. UPDATE ... RETURNING so we can notify each
// affected passenger in the same sweep.
export const expireBookingsJob: Job = {
  name: 'expire_bookings',
  schedule: '* * * * *',
  maxRuntimeSec: 45,
  async run(prisma) {
    const expired = await prisma.$queryRaw<
      Array<{ id: string; passenger_id: string; trip_id: string }>
    >`
      UPDATE bookings
      SET status = 'expired', updated_at = NOW()
      WHERE status IN ('pending', 'viewed') AND expires_at < NOW()
      RETURNING id, passenger_id, trip_id
    `;
    if (expired.length === 0) return;

    // Emit one notification row per expired booking (TZ §15.2 booking_expired).
    // The cron runs inside the API process so we can't emit Socket.IO events
    // from here without plumbing — the client picks these up on next
    // GET /notifications poll or on reconnect.
    await prisma.notification.createMany({
      data: expired.map((e) => ({
        userId: e.passenger_id,
        type: 'booking_expired',
        channel: 'telegram' as const,
        payload: { booking_id: e.id, trip_id: e.trip_id },
      })),
    });

    logger.info({ count: expired.length }, 'expire_bookings: bookings expired');
  },
};
