import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createComplaintsService } from './complaints.service.js';
import { ComplaintCreateBody, MyComplaintsQuery } from './complaints.schemas.js';
import { validate } from '@/middleware/validate.js';
import { asyncHandler } from '@/middleware/errorHandler.js';
import { requireAuth } from '@/middleware/auth.js';
import { complaintSubmitLimit } from '@/middleware/rateLimit.js';
import { uploadMemory } from '@/lib/uploads.js';
import type { Notifier } from '@/lib/notifier.js';

export function createComplaintsRouter(prisma: PrismaClient, notifier: Notifier): Router {
  const router = Router();
  const service = createComplaintsService(prisma, notifier);

  router.post(
    '/',
    requireAuth,
    complaintSubmitLimit,
    // Multer runs before Zod — the body fields from multipart/form-data arrive
    // as strings, which Zod coerces.
    uploadMemory.array('attachments', 5),
    validate({ body: ComplaintCreateBody }),
    asyncHandler(async (req, res) => {
      const files = (req.files ?? []) as Express.Multer.File[];
      const result = await service.create(
        req.user!.id,
        req.body as Parameters<typeof service.create>[1],
        files,
      );
      res.status(201).json(result);
    }),
  );

  router.get(
    '/my',
    requireAuth,
    validate({ query: MyComplaintsQuery }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as { cursor?: string; limit: number };
      const result = await service.listMine(req.user!.id, q);
      res.json(result);
    }),
  );

  return router;
}
