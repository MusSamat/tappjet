import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Notifier } from '@/lib/notifier.js';
import { createPassengerRequestsService, createPassengerRequestResponsesService } from './passenger-requests.service.js';
import {
  CreatePassengerRequestBody,
  ListRequestsQuery,
  RequestIdParam,
  RespondBody,
  ResponseIdParam,
} from './passenger-requests.schemas.js';
import { validate } from '@/middleware/validate.js';
import { asyncHandler } from '@/middleware/errorHandler.js';
import { requireAuth } from '@/middleware/auth.js';

export function createPassengerRequestsRouter(prisma: PrismaClient, notifier: Notifier): Router {
  const router = Router();
  const service = createPassengerRequestsService(prisma);
  const responsesService = createPassengerRequestResponsesService(prisma, notifier);

  // GET /passenger-requests — open requests list (public, drivers browse)
  router.get(
    '/',
    validate({ query: ListRequestsQuery }),
    asyncHandler(async (req, res) => {
      const result = await service.list(
        req.query as unknown as Parameters<typeof service.list>[0],
      );
      res.json(result);
    }),
  );

  // GET /passenger-requests/my — authenticated passenger's own requests
  router.get(
    '/my',
    requireAuth,
    asyncHandler(async (req, res) => {
      const result = await service.listMy(req.user!.id);
      res.json(result);
    }),
  );

  // GET /passenger-requests/:id — single request
  router.get(
    '/:id',
    validate({ params: RequestIdParam }),
    asyncHandler(async (req, res) => {
      const result = await service.getById(req.params.id!);
      res.json(result);
    }),
  );

  // POST /passenger-requests — create (auth required)
  router.post(
    '/',
    requireAuth,
    validate({ body: CreatePassengerRequestBody }),
    asyncHandler(async (req, res) => {
      const result = await service.create(
        req.user!.id,
        req.body as Parameters<typeof service.create>[1],
      );
      res.status(201).json(result);
    }),
  );

  // DELETE /passenger-requests/:id — cancel own request
  router.delete(
    '/:id',
    requireAuth,
    validate({ params: RequestIdParam }),
    asyncHandler(async (req, res) => {
      await service.cancel(req.params.id!, req.user!.id);
      res.status(204).end();
    }),
  );

  // POST /passenger-requests/:id/respond — driver submits an offer
  router.post(
    '/:id/respond',
    requireAuth,
    validate({ params: RequestIdParam, body: RespondBody }),
    asyncHandler(async (req, res) => {
      const result = await responsesService.respond(
        req.user!.id,
        req.params.id!,
        req.body as Parameters<typeof responsesService.respond>[2],
      );
      res.status(201).json(result);
    }),
  );

  // GET /passenger-requests/:id/responses — passenger views offers on their request
  router.get(
    '/:id/responses',
    requireAuth,
    validate({ params: RequestIdParam }),
    asyncHandler(async (req, res) => {
      const result = await responsesService.listResponses(req.params.id!, req.user!.id);
      res.json(result);
    }),
  );

  // POST /passenger-requests/:id/respond/:responseId/accept — passenger accepts offer
  router.post(
    '/:id/respond/:responseId/accept',
    requireAuth,
    validate({ params: ResponseIdParam }),
    asyncHandler(async (req, res) => {
      const result = await responsesService.acceptResponse(
        req.user!.id,
        req.params.id!,
        req.params.responseId!,
      );
      res.json(result);
    }),
  );

  // POST /passenger-requests/:id/respond/:responseId/decline — passenger declines offer
  router.post(
    '/:id/respond/:responseId/decline',
    requireAuth,
    validate({ params: ResponseIdParam }),
    asyncHandler(async (req, res) => {
      await responsesService.declineResponse(req.user!.id, req.params.id!, req.params.responseId!);
      res.status(204).end();
    }),
  );

  return router;
}
