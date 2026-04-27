import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { createLoyaltyService } from './loyalty.service.js';
import { requireAuth } from '@/middleware/auth.js';
import { asyncHandler } from '@/middleware/errorHandler.js';
import { validate } from '@/middleware/validate.js';
import type { Notifier } from '@/lib/notifier.js';

const CursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function createLoyaltyRouter(prisma: PrismaClient, notifier: Notifier): Router {
  const router = Router();
  const service = createLoyaltyService(prisma, notifier);

  // GET /loyalty/status — own loyalty status
  router.get(
    '/status',
    requireAuth,
    asyncHandler(async (req, res) => {
      const status = await service.getStatus(req.user!.id);
      res.json(status);
    }),
  );

  // GET /loyalty/transactions — own points history (cursor-based)
  router.get(
    '/transactions',
    requireAuth,
    validate({ query: CursorQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as { cursor?: string; limit: number };
      const result = await service.listTransactions(req.user!.id, q);
      res.json(result);
    }),
  );

  return router;
}
