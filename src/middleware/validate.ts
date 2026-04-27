import type { Request, RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { Errors } from '@/lib/errors.js';

/**
 * Build a middleware that validates + types one or more request parts using
 * Zod schemas. On success the parsed payload is written back to the same part
 * so handlers get narrowed types (body, query, params).
 *
 * Usage:
 *   router.post('/foo',
 *     validate({ body: FooBody, query: FooQuery }),
 *     asyncHandler(async (req, res) => {
 *       const body: z.infer<typeof FooBody> = req.body;
 *       …
 *     })
 *   );
 */

type Schemas = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  headers?: ZodTypeAny;
};

export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) {
        const parsed = schemas.body.safeParse(req.body);
        if (!parsed.success) return next(formatZodError(parsed.error, 'body'));
        req.body = parsed.data;
      }
      if (schemas.query) {
        const parsed = schemas.query.safeParse(req.query);
        if (!parsed.success) return next(formatZodError(parsed.error, 'query'));
        // express's req.query is a getter-only proxy in some versions — reassign via Object.defineProperty.
        Object.defineProperty(req, 'query', { value: parsed.data, writable: true });
      }
      if (schemas.params) {
        const parsed = schemas.params.safeParse(req.params);
        if (!parsed.success) return next(formatZodError(parsed.error, 'params'));
        req.params = parsed.data;
      }
      if (schemas.headers) {
        const parsed = schemas.headers.safeParse(req.headers);
        if (!parsed.success) return next(formatZodError(parsed.error, 'headers'));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function formatZodError(err: z.ZodError, part: string) {
  return Errors.validation({
    part,
    issues: err.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    })),
  });
}

/**
 * Helper to type a handler after validation.
 * Avoid the awkward pattern of re-asserting req.body types in every handler.
 */
export type TypedRequest<
  B extends ZodTypeAny = ZodTypeAny,
  Q extends ZodTypeAny = ZodTypeAny,
  P extends ZodTypeAny = ZodTypeAny,
> = Request<z.infer<P>, unknown, z.infer<B>, z.infer<Q>>;
