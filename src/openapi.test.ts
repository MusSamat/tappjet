import { describe, expect, it } from 'vitest';
import { openapiDocument } from './openapi.js';

// OpenAPI drift-guard. The spec is hand-authored and shipped to the web / Flutter
// / mini-app clients (codegen + the contract they build against), so silent drift
// = broken clients. These guards make any change reviewable and catch the two
// failure modes that break codegen: a renamed/removed endpoint, and a $ref that
// points at a schema that no longer exists.

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const paths = openapiDocument.paths as Record<string, Record<string, { responses?: unknown }>>;

describe('OpenAPI drift-guard', () => {
  it('API surface (METHOD + path) matches the snapshot — any change is reviewable', () => {
    const surface = Object.entries(paths)
      .flatMap(([p, ops]) =>
        Object.keys(ops)
          .filter((m) => (HTTP_METHODS as readonly string[]).includes(m))
          .map((m) => `${m.toUpperCase()} ${p}`),
      )
      .sort();
    expect(surface).toMatchSnapshot();
  });

  it('every $ref resolves to a defined component schema (codegen would break otherwise)', () => {
    const defined = new Set(Object.keys(openapiDocument.components.schemas));
    const refs: string[] = [];
    JSON.stringify(openapiDocument, (k, v) => {
      if (k === '$ref' && typeof v === 'string') refs.push(v);
      return v as unknown;
    });
    const missing = refs
      .filter((r) => r.startsWith('#/components/schemas/'))
      .map((r) => r.split('/').pop()!)
      .filter((name) => !defined.has(name));
    expect(missing).toEqual([]);
  });

  it('is a structurally valid OpenAPI 3 document (version, paths, every op has responses)', () => {
    expect(String(openapiDocument.openapi)).toMatch(/^3\./);
    expect(Object.keys(paths).length).toBeGreaterThan(0);
    for (const [p, ops] of Object.entries(paths)) {
      for (const [m, op] of Object.entries(ops)) {
        if ((HTTP_METHODS as readonly string[]).includes(m)) {
          expect(op.responses, `${m.toUpperCase()} ${p} must declare responses`).toBeTruthy();
        }
      }
    }
  });
});
