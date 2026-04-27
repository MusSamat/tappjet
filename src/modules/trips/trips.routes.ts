import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTripsService } from './trips.service.js';
import type { Notifier } from '@/lib/notifier.js';
import {
  IdempotencyHeader,
  MyTripsQuery,
  PriceSuggestionQuery,
  TripCreateBody,
  TripIdParam,
  TripPatchBody,
  TripSearchQuery,
} from './trips.schemas.js';
import { validate } from '@/middleware/validate.js';
import { asyncHandler } from '@/middleware/errorHandler.js';
import { requireAuth, requireRole } from '@/middleware/auth.js';
import { Errors } from '@/lib/errors.js';

export function createTripsRouter(prisma: PrismaClient, notifier?: Notifier): Router {
  const router = Router();
  const service = createTripsService(prisma, notifier);

  router.get(
    '/',
    validate({ query: TripSearchQuery }),
    asyncHandler(async (req, res) => {
      const result = await service.search(
        req.query as unknown as Parameters<typeof service.search>[0],
      );
      res.json(result);
    }),
  );

  // POST /trips — only verified drivers. Idempotency-Key header required.
  router.post(
    '/',
    requireAuth,
    requireRole('driver'),
    validate({ body: TripCreateBody, headers: IdempotencyHeader }),
    asyncHandler(async (req, res) => {
      const key = req.header('idempotency-key');
      if (!key) throw Errors.validation({ reason: 'missing_idempotency_key' });
      const { trip, reused } = await service.create(
        req.user!.id,
        req.body as Parameters<typeof service.create>[1],
        key,
      );
      res.status(reused ? 200 : 201).json(trip);
    }),
  );

  // GET /trips/my — must come before /:id to avoid "my" being parsed as a UUID.
  router.get(
    '/my',
    requireAuth,
    requireRole('driver'),
    validate({ query: MyTripsQuery }),
    asyncHandler(async (req, res) => {
      const result = await service.myTrips(
        req.user!.id,
        req.query as unknown as Parameters<typeof service.myTrips>[1],
      );
      res.json(result);
    }),
  );

  router.get(
    '/:id',
    validate({ params: TripIdParam }),
    asyncHandler(async (req, res) => {
      const trip = await service.getById(req.params.id!);
      res.json(trip);
    }),
  );

  router.patch(
    '/:id',
    requireAuth,
    requireRole('driver'),
    validate({ params: TripIdParam, body: TripPatchBody }),
    asyncHandler(async (req, res) => {
      const updated = await service.patch(
        req.params.id!,
        req.user!.id,
        req.body as Parameters<typeof service.patch>[2],
      );
      res.json(updated);
    }),
  );

  router.patch(
    '/:id/complete',
    requireAuth,
    requireRole('driver'),
    validate({ params: TripIdParam }),
    asyncHandler(async (req, res) => {
      const result = await service.complete(req.params.id!, req.user!.id);
      res.json(result);
    }),
  );

  router.delete(
    '/:id',
    requireAuth,
    requireRole('driver'),
    validate({ params: TripIdParam }),
    asyncHandler(async (req, res) => {
      const reason =
        typeof req.body?.reason === 'string' ? (req.body.reason as string) : undefined;
      const result = await service.cancel(req.params.id!, req.user!.id, reason);
      res.json(result);
    }),
  );

  return router;
}

// Separate router for /routes/* because the path doesn't belong under /trips —
// same service though.
export function createRoutesRouter(prisma: PrismaClient): Router {
  const router = Router();
  const service = createTripsService(prisma);

  router.get(
    '/price-suggestion',
    requireAuth,
    validate({ query: PriceSuggestionQuery }),
    asyncHandler(async (req, res) => {
      const { from, to } = req.query as unknown as { from: string; to: string };
      const result = await service.priceSuggestion(from, to);
      res.json(result);
    }),
  );

  return router;
}
