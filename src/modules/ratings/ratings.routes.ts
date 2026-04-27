import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createRatingsService } from './ratings.service.js';
import { PendingRatingsQuery, RatingCreateBody } from './ratings.schemas.js';
import { validate } from '@/middleware/validate.js';
import { asyncHandler } from '@/middleware/errorHandler.js';
import { requireAuth } from '@/middleware/auth.js';
import type { Notifier } from '@/lib/notifier.js';

export function createRatingsRouter(prisma: PrismaClient, notifier: Notifier): Router {
  const router = Router();
  const service = createRatingsService(prisma, notifier);

  router.post(
    '/',
    requireAuth,
    validate({ body: RatingCreateBody }),
    asyncHandler(async (req, res) => {
      const result = await service.create(
        req.user!.id,
        req.body as Parameters<typeof service.create>[1],
      );
      res.status(201).json(result);
    }),
  );

  router.get(
    '/pending',
    requireAuth,
    validate({ query: PendingRatingsQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as { cursor?: string; limit: number };
      const result = await service.pending(req.user!.id, q);
      res.json(result);
    }),
  );

  return router;
}
