import type { Job } from '@/cron/scheduler.js';
import { logger } from '@/lib/logger.js';

// TZ §21 trip_reminder_2h: every 5 minutes, find active trips departing within
// the next 2 hours and emit `trip_reminder` notifications to every participant
// (driver + accepted passengers). We de-duplicate via a WHERE NOT EXISTS so a
// trip's reminder fires at most once, regardless of how many 5-minute ticks
// land inside the 2-hour window.
export const tripReminder2hJob: Job = {
  name: 'trip_reminder_2h',
  schedule: '*/5 * * * *',
  maxRuntimeSec: 60,
  async run(prisma) {
    const emitted = await prisma.$executeRaw`
      INSERT INTO notifications (id, user_id, type, channel, payload, created_at)
      SELECT gen_random_uuid(), u.user_id, 'trip_reminder', 'telegram',
             jsonb_build_object('trip_id', t.id,
                                'origin_city', t.origin_city,
                                'destination_city', t.destination_city,
                                'departure_at', t.departure_at),
             NOW()
      FROM trips t
      JOIN LATERAL (
        SELECT t.driver_id AS user_id
        UNION
        SELECT b.passenger_id AS user_id FROM bookings b
          WHERE b.trip_id = t.id AND b.status = 'accepted'
      ) u ON TRUE
      WHERE t.status = 'active'
        AND t.departure_at > NOW()
        AND t.departure_at <= NOW() + INTERVAL '2 hours'
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.user_id = u.user_id
            AND n.type = 'trip_reminder'
            AND (n.payload->>'trip_id')::uuid = t.id
        )
    `;
    if (emitted > 0) logger.info({ count: emitted }, 'trip_reminder_2h: notifications emitted');
  },
};
