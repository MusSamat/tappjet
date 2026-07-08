import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createCarsService } from './cars.service.js';
import { CarCreateBody, CarIdParam } from './cars.schemas.js';
import { validate } from '@/middleware/validate.js';
import { asyncHandler } from '@/middleware/errorHandler.js';
import { requireAuth, requirePhone } from '@/middleware/auth.js';

export function createCarsRouter(prisma: PrismaClient): Router {
  const router = Router();
  const service = createCarsService(prisma);

  // GET /cars — the authed user's garage
  router.get(
    '/',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({ data: await service.listMy(req.user!.id) });
    }),
  );

  // POST /cars — add a car (no verification required; Phase 1)
  router.post(
    '/',
    requireAuth,
    requirePhone,
    validate({ body: CarCreateBody }),
    asyncHandler(async (req, res) => {
      const car = await service.create(req.user!.id, req.body as Parameters<typeof service.create>[1]);
      res.status(201).json(car);
    }),
  );

  // DELETE /cars/:id — soft delete (blocked while active trips ride on it)
  router.delete(
    '/:id',
    requireAuth,
    validate({ params: CarIdParam }),
    asyncHandler(async (req, res) => {
      await service.remove(req.user!.id, req.params.id!);
      res.status(204).end();
    }),
  );

  return router;
}
