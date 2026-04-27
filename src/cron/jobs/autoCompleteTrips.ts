import type { Job } from '@/cron/scheduler.js';
import { logger } from '@/lib/logger.js';
import { POINTS_PER_TRIP, tierForPoints } from '@/modules/loyalty/loyalty.service.js';

// TZ §10.3 auto-close: active trips where (departure + estimated_duration + 2h)
// is in the past become "completed", and both parties get a rating-request
// notification. Runs every 15 minutes (TZ §21 auto_complete_trips cron).
//
// Implemented in a single SQL pass for atomicity — the UPDATE ... RETURNING
// gives us the ids we just closed without a second query.
export const autoCompleteTripsJob: Job = {
  name: 'auto_complete_trips',
  // Every 15 minutes — we avoid "0,15,30,45 * * * *" because node-cron shows
  // nicer output with the step form; semantics are identical.
  schedule: '*/15 * * * *',
  maxRuntimeSec: 120,
  async run(prisma) {
    // INTERVAL '2 hours' added to estimated_duration (minutes). Postgres needs
    // explicit interval math; we compose it from the column.
    const closed = await prisma.$queryRaw<Array<{ id: string; driver_id: string }>>`
      UPDATE trips
      SET status = 'completed',
          updated_at = NOW(),
          version = version + 1
      WHERE status = 'active'
        AND departure_at + (estimated_duration_min::text || ' minutes')::interval
            + INTERVAL '2 hours' < NOW()
      RETURNING id, driver_id
    `;
    if (closed.length === 0) return;

    // Emit rating_request notifications — one per booking participant (driver
    // + each accepted passenger). TZ §15.2 trip_completed_rate.
    // We do this in a single INSERT from SELECT for efficiency.
    await prisma.$executeRaw`
      INSERT INTO notifications (id, user_id, type, channel, payload, created_at)
      SELECT gen_random_uuid(), u.user_id, 'trip_completed_rate', 'telegram',
             jsonb_build_object('trip_id', t.id, 'origin_city', t.origin_city,
                                'destination_city', t.destination_city),
             NOW()
      FROM trips t
      JOIN LATERAL (
        SELECT t.driver_id AS user_id
        UNION
        SELECT b.passenger_id AS user_id FROM bookings b
          WHERE b.trip_id = t.id AND b.status = 'accepted'
      ) u ON TRUE
      WHERE t.id = ANY(${closed.map((c) => c.id)}::uuid[])
    `;

    // Flip all still-accepted bookings to completed so passengers can rate.
    await prisma.booking.updateMany({
      where: { tripId: { in: closed.map((c) => c.id) }, status: 'accepted' },
      data: { status: 'completed' },
    });

    // Bump driver totals and award loyalty points to all participants.
    for (const { id: tripId, driver_id } of closed) {
      await prisma.driverProfile.updateMany({
        where: { userId: driver_id },
        data: { totalTrips: { increment: 1 } },
      });

      // Collect all participants: driver + accepted passengers.
      const participants = await prisma.$queryRaw<Array<{ user_id: string }>>`
        SELECT ${driver_id}::uuid AS user_id
        UNION
        SELECT passenger_id AS user_id FROM bookings
          WHERE trip_id = ${tripId}::uuid AND status = 'completed'
      `;

      for (const { user_id } of participants) {
        // Idempotent upsert of loyalty transaction.
        const alreadyAwarded = await prisma.loyaltyTransaction.findFirst({
          where: { userId: user_id, tripId, source: 'trip_completed' },
        });
        if (alreadyAwarded) continue;

        await prisma.loyaltyTransaction.create({
          data: { userId: user_id, points: POINTS_PER_TRIP, source: 'trip_completed', tripId },
        });

        const updated = await prisma.user.update({
          where: { id: user_id },
          data: { loyaltyPoints: { increment: POINTS_PER_TRIP } },
          select: { loyaltyPoints: true, loyaltyTier: true },
        });

        const newTier = tierForPoints(updated.loyaltyPoints);
        if (newTier !== updated.loyaltyTier) {
          await prisma.user.update({
            where: { id: user_id },
            data: { loyaltyTier: newTier },
          });
          // Notifier is not wired into cron jobs — tier changes will surface on
          // next GET /loyalty/status or via the notification on next login.
        }
      }
    }

    logger.info({ count: closed.length }, 'auto_complete_trips: closed trips');
  },
};
