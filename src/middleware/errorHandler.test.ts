import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestContext } from './requestContext.js';
import { asyncHandler, globalErrorHandler, notFoundHandler } from './errorHandler.js';
import { Errors } from '@/lib/errors.js';

function buildApp(fn: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.use(requestContext);
  app.get('/boom', fn);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

describe('globalErrorHandler', () => {
  it('formats an AppError into the spec envelope', async () => {
    const app = buildApp(
      asyncHandler(() => {
        throw Errors.seatsNotAvailable({ seats_requested: 2, seats_available: 0 });
      }),
    );

    const res = await request(app).get('/boom').set('Accept-Language', 'ru');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEATS_NOT_AVAILABLE');
    expect(res.body.error.message).toMatch(/Свободных/);
    expect(res.body.error.message_kg).toMatch(/Бош/);
    expect(res.body.error.details.seats_requested).toBe(2);
    expect(res.body.error.request_id).toBeDefined();
  });

  it('returns localized message for kg', async () => {
    const app = buildApp(
      asyncHandler(() => {
        throw Errors.otpExpired();
      }),
    );
    const res = await request(app).get('/boom').set('Accept-Language', 'kg');
    expect(res.status).toBe(410);
    expect(res.body.error.message).toContain('Ырастоо');
  });

  it('maps unhandled Error to 500 INTERNAL_ERROR', async () => {
    const app = buildApp(
      asyncHandler(() => {
        throw new Error('boom');
      }),
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('notFoundHandler returns 404 through the same pipeline', async () => {
    const app = buildApp(asyncHandler(() => Promise.resolve()));
    const res = await request(app).get('/nowhere');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('maps malformed JSON body to VALIDATION_ERROR', async () => {
    const app = express();
    app.use(express.json());
    app.use(requestContext);
    app.post('/thing', (_req, res) => res.json({}));
    app.use(globalErrorHandler);
    const res = await request(app).post('/thing').set('content-type', 'application/json').send('{');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
