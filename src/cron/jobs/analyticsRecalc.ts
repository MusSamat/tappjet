import type { Job } from '@/cron/scheduler.js';
import { logger } from '@/lib/logger.js';

// TZ §21 analytics_recalc: every 30 minutes, refresh the materialized KPI
// snapshot that the admin dashboard reads. In MVP we store a single JSON blob
// in a dedicated table so the dashboard queries stay fast even as the DB grows.
//
// We don't use PostgreSQL MATERIALIZED VIEWs here because Prisma migrations
// don't manage them; a plain table + incremental upsert is simpler and
// sufficient for MVP traffic.
export const analyticsRecalcJob: Job = {
  name: 'analytics_recalc',
  schedule: '*/30 * * * *',
  maxRuntimeSec: 60,
  async run(prisma) {
    const [
      totalUsers,
      activeDrivers,
      activeTrips,
      completedTrips7d,
      completedTrips30d,
      pendingVerifications,
      openComplaints,
      avgDriverRating,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT driver_id)::bigint AS count
        FROM trips
        WHERE created_at > NOW() - INTERVAL '7 days'
      `.then((r) => Number(r[0]?.count ?? 0)),
      prisma.trip.count({ where: { status: 'active' } }),
      prisma.trip.count({
        where: { status: 'completed', updatedAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
      }),
      prisma.trip.count({
        where: { status: 'completed', updatedAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
      }),
      prisma.driverProfile.count({ where: { verificationStatus: 'pending' } }),
      prisma.complaint.count({ where: { status: { in: ['new', 'in_review'] } } }),
      prisma.$queryRaw<[{ avg: string | null }]>`
        SELECT AVG(rating)::text AS avg
        FROM users
        WHERE 'driver' = ANY(roles) AND rating_count >= 3 AND deleted_at IS NULL
      `.then((r) => (r[0]?.avg ? parseFloat(r[0].avg).toFixed(2) : null)),
    ]);

    const snapshot = {
      total_users: totalUsers,
      active_drivers_7d: activeDrivers,
      active_trips: activeTrips,
      completed_trips_7d: completedTrips7d,
      completed_trips_30d: completedTrips30d,
      pending_verifications: pendingVerifications,
      open_complaints: openComplaints,
      avg_driver_rating: avgDriverRating,
      recalculated_at: new Date().toISOString(),
    };

    // Upsert into a dedicated singleton row (analytics_snapshot table created
    // by migration; key = 'kpi').
    await prisma.$executeRaw`
      INSERT INTO analytics_snapshots (key, data, updated_at)
      VALUES ('kpi', ${JSON.stringify(snapshot)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
        SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
    `;

    logger.info('analytics_recalc: snapshot updated');
  },
};
