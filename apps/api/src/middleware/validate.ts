/**
 * Middleware — request validation helpers.
 *
 * These are plain async functions rather than middleware because each handler
 * needs the *typed* result. They all:
 *   - reject unknown-shaped input with a 422 and field-level details
 *   - cap body size before parsing (a 10 MB JSON body is refused, not parsed)
 *   - normalise Zod issues into the shared `ApiErrorDetail` shape
 *
 * The schemas themselves live in `packages/shared/src/validation.ts` so the
 * frontend, the API and the tests all validate against one definition.
 */
import type { z } from 'zod';
import type { AppContext } from '../env.js';
import type { ApiErrorDetail } from '@sholynk/shared';
import { AppError } from '../lib/errors.js';

export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

function toDetails(error: z.ZodError): ApiErrorDetail[] {
  return error.issues.slice(0, 25).map((issue) => ({
    field: issue.path.length ? issue.path.join('.') : undefined,
    message: issue.message,
  }));
}

/**
 * Parses and validates a JSON body.
 * `schema` is a Zod schema; the return type is inferred, so handlers get real
 * types instead of `any` straight from `await c.req.json()`.
 */
export async function parseJson<S extends z.ZodType>(
  c: AppContext,
  schema: S,
): Promise<z.infer<S>> {
  const contentType = c.req.header('content-type') ?? '';
  const contentLength = Number.parseInt(c.req.header('content-length') ?? '0', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', `Request body must be under ${MAX_JSON_BODY_BYTES / 1024} KB`);
  }
  if (contentType && !contentType.includes('application/json') && !contentType.includes('+json')) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Send the request body as application/json');
  }

  let raw: unknown;
  try {
    const text = await c.req.text();
    if (text.length > MAX_JSON_BODY_BYTES) {
      throw new AppError('PAYLOAD_TOO_LARGE', `Request body must be under ${MAX_JSON_BODY_BYTES / 1024} KB`);
    }
    raw = text.trim() ? JSON.parse(text) : {};
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('VALIDATION_ERROR', 'Request body is not valid JSON', {
      details: [{ message: 'Expected a JSON object.' }],
    });
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Some fields need your attention', {
      details: toDetails(result.error),
    });
  }
  return result.data;
}

/** Validates query-string parameters (all values arrive as strings). */
export function parseQuery<S extends z.ZodType>(c: AppContext, schema: S): z.infer<S> {
  const url = new URL(c.req.url);
  const raw: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    // Repeated keys: keep the first value; array params are not used by this API.
    if (!(key in raw)) raw[key] = value;
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query parameters', {
      details: toDetails(result.error),
    });
  }
  return result.data;
}

/**
 * Validates a single path parameter and returns a definitely-present value.
 *
 * Preferred over `parseParams` with a computed-key object schema: with
 * `noUncheckedIndexedAccess` enabled, an index-signature lookup types as
 * `T | undefined`, which would push pointless null checks into every handler.
 */
export function parseParam<S extends z.ZodType>(c: AppContext, name: string, schema: S): z.infer<S> {
  const result = schema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', `Invalid "${name}" in the URL`, {
      details: toDetails(result.error),
    });
  }
  return result.data;
}

/** Validates the whole path-parameter object (rarely needed; see parseParam). */
export function parseParams<S extends z.ZodType>(c: AppContext, schema: S): z.infer<S> {
  const result = schema.safeParse(c.req.param());
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid path parameters', {
      details: toDetails(result.error),
    });
  }
  return result.data;
}

/**
 * Parses a body that may arrive as JSON *or* as a classic HTML form
 * (`application/x-www-form-urlencoded` / `multipart/form-data`). The public
 * newsletter and contact forms post urlencoded bodies exactly like the legacy
 * site did; the same endpoints also accept JSON for programmatic callers.
 */
export async function parseFormOrJson<S extends z.ZodType>(
  c: AppContext,
  schema: S,
): Promise<z.infer<S>> {
  const contentType = (c.req.header('content-type') ?? '').toLowerCase();
  if (contentType.includes('application/json')) return parseJson(c, schema);

  assertBodySize(c, MAX_JSON_BODY_BYTES);
  let raw: Record<string, unknown>;
  try {
    raw = (await c.req.parseBody()) as Record<string, unknown>;
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body could not be parsed', {
      details: [{ message: 'Send JSON or a urlencoded/multipart form body.' }],
    });
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Some fields need your attention', {
      details: toDetails(result.error),
    });
  }
  return result.data;
}

/** Rejects a request whose body is larger than `maxBytes`. */
export function assertBodySize(c: AppContext, maxBytes: number): void {
  const contentLength = Number.parseInt(c.req.header('content-length') ?? '0', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AppError('PAYLOAD_TOO_LARGE', `Request body must be under ${Math.ceil(maxBytes / 1024)} KB`);
  }
}
