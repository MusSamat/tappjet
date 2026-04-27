import type { PrismaClient } from '@prisma/client';
import { Errors } from '@/lib/errors.js';

export interface KpiCards {
  users: { total: number; last_7d: number; last_30d: number };
  activeDrivers7d: number;       // distinct drivers with trips in last 7d
  publishedTripsNow: number;     // active trips right now
  completedTrips: { last_7d: number; last_30d: number };
  acceptanceRate7d: number | null; // accepted / (accepted + rejected) × 100
  pendingVerifications: number;
  openComplaints: number;
  avgDriverRating: number | null; // avg users.rating WHERE 'driver' IN roles AND rating_count >= 3
}

export interface ChartResult {
  name: string;
  data: unknown;
}

export interface AdminAnalyticsService {
  kpi(): Promise<KpiCards>;
  chart(name: string, days?: number): Promise<ChartResult>;
}

export function createAdminAnalyticsService(prisma: PrismaClient): AdminAnalyticsService {
  async function kpi(): Promise<KpiCards> {
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60_000);

    const [
      totalUsers,
      users7d,
      users30d,
      activeDrivers7dRows,
      publishedTripsNow,
      completed7d,
      completed30d,
      accepted7d,
      rejected7d,
      pendingVerif,
      openComplaints,
      avgDriver,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, createdAt: { gte: d7 } } }),
      prisma.user.count({ where: { deletedAt: null, createdAt: { gte: d30 } } }),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT driver_id) AS count
        FROM trips
        WHERE created_at >= ${d7}
      `,
      prisma.trip.count({ where: { status: 'active' } }),
      prisma.trip.count({ where: { status: 'completed', updatedAt: { gte: d7 } } }),
      prisma.trip.count({ where: { status: 'completed', updatedAt: { gte: d30 } } }),
      prisma.booking.count({ where: { status: 'accepted', updatedAt: { gte: d7 } } }),
      prisma.booking.count({ where: { status: 'rejected', updatedAt: { gte: d7 } } }),
      prisma.driverProfile.count({ where: { verificationStatus: 'pending' } }),
      prisma.complaint.count({ where: { status: { in: ['new', 'in_review'] } } }),
      prisma.$queryRaw<Array<{ avg: string | null }>>`
        SELECT AVG(rating)::float AS avg
        FROM users
        WHERE deleted_at IS NULL
          AND 'driver' = ANY(roles)
          AND rating_count >= 3
      `,
    ]);

    const totalDecisions = accepted7d + rejected7d;
    const acceptanceRate = totalDecisions === 0 ? null : (accepted7d / totalDecisions) * 100;

    return {
      users: { total: totalUsers, last_7d: users7d, last_30d: users30d },
      activeDrivers7d: Number(activeDrivers7dRows[0]?.count ?? 0),
      publishedTripsNow,
      completedTrips: { last_7d: completed7d, last_30d: completed30d },
      acceptanceRate7d: acceptanceRate === null ? null : Math.round(acceptanceRate * 100) / 100,
      pendingVerifications: pendingVerif,
      openComplaints,
      avgDriverRating:
        avgDriver[0]?.avg === null || avgDriver[0]?.avg === undefined
          ? null
          : Math.round(Number(avgDriver[0].avg) * 100) / 100,
    };
  }

  async function chart(name: string, days = 30): Promise<ChartResult> {
    const d = Math.max(7, Math.min(days, 90));
    switch (name) {
      case 'registrations_by_day':
        return { name, data: await chartRegistrations(d) };
      case 'trips_by_day':
        return { name, data: await chartTrips(d) };
      case 'top_routes':
        return { name, data: await chartTopRoutes(d) };
      case 'activity_heatmap':
        return { name, data: await chartActivityHeatmap(d) };
      case 'rating_by_day':
        return { name, data: await chartRatingByDay(d) };
      case 'onboarding_funnel':
        return { name, data: await chartOnboardingFunnel() };
      default:
        throw Errors.notFound('Chart');
    }
  }

  // ─── chart queries ─────────────────────────────────────────────────
  async function chartRegistrations(days: number): Promise<Array<{ date: string; count: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
      SELECT date_trunc('day', created_at AT TIME ZONE 'Asia/Bishkek')::date AS date,
             COUNT(*)::bigint AS count
      FROM users
      WHERE deleted_at IS NULL AND created_at >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), count: Number(r.count) }));
  }

  async function chartTrips(days: number): Promise<Array<{ date: string; status: string; count: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const rows = await prisma.$queryRaw<
      Array<{ date: Date; status: string; count: bigint }>
    >`
      SELECT date_trunc('day', created_at AT TIME ZONE 'Asia/Bishkek')::date AS date,
             status, COUNT(*)::bigint AS count
      FROM trips
      WHERE created_at >= ${since}
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `;
    return rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      status: r.status,
      count: Number(r.count),
    }));
  }

  async function chartTopRoutes(days: number): Promise<
    Array<{ from: string; to: string; count: number }>
  > {
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const rows = await prisma.$queryRaw<
      Array<{ origin_city: string; destination_city: string; count: bigint }>
    >`
      SELECT origin_city, destination_city, COUNT(*)::bigint AS count
      FROM trips
      WHERE created_at >= ${since}
      GROUP BY 1, 2
      ORDER BY count DESC
      LIMIT 10
    `;
    return rows.map((r) => ({
      from: r.origin_city,
      to: r.destination_city,
      count: Number(r.count),
    }));
  }

  async function chartActivityHeatmap(days: number): Promise<
    Array<{ dow: number; hour: number; count: number }>
  > {
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const rows = await prisma.$queryRaw<
      Array<{ dow: number; hour: number; count: bigint }>
    >`
      SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Bishkek')::int AS dow,
             EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Bishkek')::int AS hour,
             COUNT(*)::bigint AS count
      FROM trips
      WHERE created_at >= ${since}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;
    return rows.map((r) => ({ dow: r.dow, hour: r.hour, count: Number(r.count) }));
  }

  async function chartRatingByDay(days: number): Promise<Array<{ date: string; avg: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const rows = await prisma.$queryRaw<Array<{ date: Date; avg: number }>>`
      SELECT date_trunc('day', created_at AT TIME ZONE 'Asia/Bishkek')::date AS date,
             AVG(score)::float AS avg
      FROM ratings
      WHERE created_at >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      avg: Math.round(Number(r.avg) * 100) / 100,
    }));
  }

  async function chartOnboardingFunnel(): Promise<Array<{ stage: string; count: number }>> {
    // TZ §18.3 — started, verified phone, filled name, first action, day-1
    // retention, second completed booking.
    const [started, phoneVerified, nameFilled, firstAction, day1, secondBooking] =
      await Promise.all([
        prisma.user.count({ where: { deletedAt: null } }),
        prisma.user.count({ where: { deletedAt: null, phoneVerifiedAt: { not: null } } }),
        prisma.user.count({
          where: {
            deletedAt: null,
            phoneVerifiedAt: { not: null },
            name: { notIn: ['Новый пользователь', 'Удалённый пользователь'] },
          },
        }),
        // Users who created a booking OR trip
        prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(DISTINCT uid) AS count FROM (
            SELECT passenger_id AS uid FROM bookings
            UNION
            SELECT driver_id AS uid FROM trips
          ) a
        `,
        // Users with last_seen_at > 1d after created_at
        prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count
          FROM users
          WHERE deleted_at IS NULL
            AND last_seen_at IS NOT NULL
            AND last_seen_at > created_at + INTERVAL '1 day'
        `,
        prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count FROM (
            SELECT passenger_id, COUNT(*) c
            FROM bookings
            WHERE status = 'completed'
            GROUP BY passenger_id
            HAVING COUNT(*) >= 2
          ) a
        `,
      ]);

    return [
      { stage: 'started', count: started },
      { stage: 'phone_verified', count: phoneVerified },
      { stage: 'name_filled', count: nameFilled },
      { stage: 'first_action', count: Number(firstAction[0]?.count ?? 0) },
      { stage: 'day_1_retention', count: Number(day1[0]?.count ?? 0) },
      { stage: 'second_booking', count: Number(secondBooking[0]?.count ?? 0) },
    ];
  }

  return { kpi, chart };
}
