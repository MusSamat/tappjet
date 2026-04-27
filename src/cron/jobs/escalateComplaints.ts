import type { Job } from '@/cron/scheduler.js';
import { logger } from '@/lib/logger.js';

// TZ §21 escalate_complaints — every 30 min. P0 means category='safety' per
// the priority matrix (§16.3). A complaint still in 'new' or 'in_review' for
// more than 1h triggers an escalation; we mark it via escalated_at so the
// same complaint doesn't get re-escalated on every tick.
export const escalateComplaintsJob: Job = {
  name: 'escalate_complaints',
  schedule: '*/30 * * * *',
  maxRuntimeSec: 60,
  async run(prisma) {
    const cutoff = new Date(Date.now() - 60 * 60_000);

    const toEscalate = await prisma.$queryRaw<
      Array<{ id: string; category: string; reporter_id: string }>
    >`
      UPDATE complaints
      SET escalated_at = NOW()
      WHERE category = 'safety'
        AND status IN ('new', 'in_review')
        AND created_at < ${cutoff}
        AND escalated_at IS NULL
      RETURNING id, category, reporter_id
    `;
    if (toEscalate.length === 0) return;

    // Active admins (superadmin included) all get an in-process notification
    // row so the Admin Panel badge highlights the SLA breach. Per TZ the
    // "SMS to superadmin" channel is Stage 2 — we log prominently for now so
    // an on-call operator can act even without SMS wired.
    const supers = await prisma.admin.findMany({
      where: { isActive: true, role: 'superadmin' },
      select: { id: true, email: true },
    });
    for (const c of toEscalate) {
      logger.warn(
        {
          complaint_id: c.id,
          category: c.category,
          sent_to: supers.map((s) => s.email),
        },
        'ESCALATION: P0 complaint unaddressed >1h',
      );
    }
  },
};
