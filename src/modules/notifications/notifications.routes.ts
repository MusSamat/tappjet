import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { validate } from '@/middleware/validate.js';
import { asyncHandler } from '@/middleware/errorHandler.js';
import { requireAuth } from '@/middleware/auth.js';
import { cursorArgs, sliceAndNext, CursorPaginationQuery } from '@/lib/pagination.js';
import { Errors } from '@/lib/errors.js';

const ListQuery = CursorPaginationQuery.extend({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

const IdParam = z.object({ id: z.string().uuid() });

// Types that live in the notifications table for admin triage / trace history
// but must never surface in a user's in-app feed — e.g. the 24h verification
// SLA-breach escalation (escalate_verifications cron), which is an admin
// concern written per-driver only to trace history. Clients can't render it, so
// it would show as a generic "Уведомление" and flood the feed every 4h.
const HIDDEN_FROM_USER_FEED = ['verification_sla_breach'];

export function createNotificationsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth,
    validate({ query: ListQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as { cursor?: string; limit: number; unread?: boolean };
      const rows = await prisma.notification.findMany({
        where: {
          userId: req.user!.id,
          type: { notIn: HIDDEN_FROM_USER_FEED },
          ...(q.unread === true ? { readAt: null } : {}),
          ...(q.unread === false ? { readAt: { not: null } } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs({ cursor: q.cursor, limit: q.limit }),
      });
      const unreadCount = await prisma.notification.count({
        where: {
          userId: req.user!.id,
          readAt: null,
          type: { notIn: HIDDEN_FROM_USER_FEED },
        },
      });
      res.json({ ...sliceAndNext(rows, q.limit), unreadCount });
    }),
  );

  // Bulk: one UPDATE marks everything unread, including rows on pages the
  // client never loaded (the old client-side fan-out missed those).
  router.patch(
    '/read-all',
    requireAuth,
    asyncHandler(async (req, res) => {
      const r = await prisma.notification.updateMany({
        where: { userId: req.user!.id, readAt: null },
        data: { readAt: new Date() },
      });
      res.json({ updated: r.count });
    }),
  );

  router.patch(
    '/:id/read',
    requireAuth,
    validate({ params: IdParam }),
    asyncHandler(async (req, res) => {
      const n = await prisma.notification.findUnique({ where: { id: req.params.id! } });
      if (!n || n.userId !== req.user!.id) throw Errors.notFound('Notification');
      if (n.readAt) {
        res.json(n);
        return;
      }
      const updated = await prisma.notification.update({
        where: { id: n.id },
        data: { readAt: new Date() },
      });
      res.json(updated);
    }),
  );

  return router;
}
