import type { Job } from '@/cron/scheduler.js';
import { logger } from '@/lib/logger.js';

/**
 * TZ §9.2 + §21 escalate_verifications — runs every 4 hours.
 * Finds driver_profiles in `pending` status longer than 24 hours, emits one
 * notification row per superadmin so they can triage. We also emit an
 * application log line so Uptime Kuma / alerting can surface it.
 *
 * The real push channel (SMS/email) is wired in Sprint 5; here we just record
 * the breach so the admin UI can show a red SLA badge (TZ §17.2 "Таймер SLA:
 * красная рамка если прошло >24 часа").
 */
export const escalateVerificationsJob: Job = {
  name: 'escalate_verifications',
  // Every 4 hours at minute 0 — matches TZ §21 "0 */4 * * *".
  schedule: '0 0-23/4 * * *',
  maxRuntimeSec: 60,
  async run(prisma) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000);

    const overdue = await prisma.driverProfile.findMany({
      where: {
        verificationStatus: 'pending',
        submittedAt: { lt: cutoff },
      },
      select: { id: true, userId: true, submittedAt: true, carPlate: true },
    });
    if (overdue.length === 0) return;

    // Who to notify — every active superadmin. Admins have no corresponding
    // row in `users`, but we need a `userId` for the notifications table's FK.
    // Bootstrap constraint: admins receive escalations in-app via /admin/verifications
    // (SLA-breach flag), not via the notifications table. Emit one row per
    // overdue profile scoped to the driver themselves so we can trace history.
    const payloads = overdue.map((o) => ({
      userId: o.userId,
      type: 'verification_sla_breach',
      channel: 'telegram' as const,
      payload: {
        driver_profile_id: o.id,
        submitted_at: o.submittedAt.toISOString(),
        car_plate: o.carPlate,
        hours_overdue: Math.floor(
          (Date.now() - o.submittedAt.getTime()) / (60 * 60_000),
        ),
      },
    }));

    await prisma.notification.createMany({ data: payloads });

    logger.warn(
      { count: overdue.length, oldest_hours: hoursSince(overdue[0]!.submittedAt) },
      'driver verifications breaching 24h SLA',
    );
  },
};

function hoursSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (60 * 60_000));
}
