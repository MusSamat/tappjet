import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from './validate.js';
import { requestContext } from './requestContext.js';
import { globalErrorHandler } from './errorHandler.js';

describe('validate middleware', () => {
  it('rejects invalid body with VALIDATION_ERROR + field issues', async () => {
    const app = express();
    app.use(express.json());
    app.use(requestContext);
    app.post(
      '/x',
      validate({ body: z.object({ name: z.string().min(3), age: z.number() }) }),
      (_req, res) => res.json({ ok: true }),
    );
    app.use(globalErrorHandler);

    const res = await request(app).post('/x').send({ name: 'a', age: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.issues.length).toBeGreaterThan(0);
    expect(res.body.error.details.part).toBe('body');
  });

  it('passes a valid body and narrows type', async () => {
    const app = express();
    app.use(express.json());
    app.use(requestContext);
    app.post(
      '/x',
      validate({ body: z.object({ name: z.string().min(3) }) }),
      (req, res) => res.json({ got: req.body }),
    );
    app.use(globalErrorHandler);

    const res = await request(app).post('/x').send({ name: 'Asan' });
    expect(res.status).toBe(200);
    expect(res.body.got).toEqual({ name: 'Asan' });
  });

  it('validates query separately from body', async () => {
    const app = express();
    app.use(requestContext);
    app.get(
      '/q',
      validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(50) }) }),
      (req, res) => res.json({ q: req.query }),
    );
    app.use(globalErrorHandler);

    const bad = await request(app).get('/q').query({ limit: '999' });
    expect(bad.status).toBe(400);

    const good = await request(app).get('/q').query({ limit: '10' });
    expect(good.status).toBe(200);
    expect(good.body.q.limit).toBe(10);
  });
});
