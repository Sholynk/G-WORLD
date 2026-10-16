/**
 * Middleware — error handling.
 *
 * Every failure leaves the API in exactly one shape (see
 * packages/shared/src/api-contract.ts). Two guarantees matter here:
 *
 *   1. No internal detail escapes. Unexpected errors become `INTERNAL_ERROR`
 *      with a generic message; the stack, SQL and binding values stay in logs
 *      (identified by `request_id`, which the client receives).
 *   2. Expected failures are explicit. `AppError` carries the code and status,
 *      so `throw forbidden()` in a handler is enough — no nested if/else.
 */
import type { Context } from 'hono';
import type { AppEnv } from '../env.js';
import type { ApiErrorCode, ApiErrorDetail } from '@g-world/shared';
import { ERROR_STATUS } from '@g-world/shared';
import { AppError, isAppError } from '../lib/errors.js';
import { classifySqliteError } from '../db/client.js';
import { applySecurityHeaders } from '../lib/security-headers.js';

export interface EnvelopeMeta {
  request_id: string;
  timestamp: string;
  pagination?: unknown;
  notices?: string[];
}

export function metaFor(c: Context<AppEnv>, extra: Partial<EnvelopeMeta> = {}): EnvelopeMeta {
  return {
    request_id: c.get('requestId') ?? 'req_unknown',
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

/**
 * Maps SQLite constraint failures to the error a user should see. A UNIQUE
 * violation on `users.email` is a 409 "email already registered", not a 500 —
 * and the mapping is centralised so no handler has to guess.
 */
function fromDatabaseError(error: unknown): AppError | null {
  const info = classifySqliteError(error);
  if (info.kind === 'other') return null;

  const target = info.target ?? '';
  if (info.kind === 'unique') {
    if (target.includes('users.email')) {
      return new AppError('CONFLICT', 'An account with this email address already exists');
    }
    if (target.includes('enrollments.user_id')) {
      return new AppError('CONFLICT', 'You are already enrolled in this course');
    }
    if (target.includes('certificates.user_id') || target.includes('certificates.enrollment_id')) {
      return new AppError('CONFLICT', 'A certificate has already been issued for this course');
    }
    if (target.includes('slug')) {
      return new AppError('CONFLICT', 'That URL slug is already in use');
    }
    if (target.includes('roles.key') || target.includes('permissions.key')) {
      return new AppError('CONFLICT', 'That role or permission already exists');
    }
    return new AppError('CONFLICT', 'That record already exists');
  }

  if (info.kind === 'foreign_key') {
    return new AppError('CONFLICT', 'This action conflicts with related records', {
      details: [{ message: 'A referenced record is missing or still in use.' }],
    });
  }

  if (info.kind === 'check' || info.kind === 'not_null') {
    return new AppError('VALIDATION_ERROR', 'The submitted data is not valid', {
      details: [{ field: target || undefined, message: 'Value is out of the allowed range.' }],
    });
  }

  return null;
}

/**
 * The application error handler.
 *
 * Registered with `app.onError()` rather than as a `try { await next() }`
 * middleware, because of how Hono composes handlers: when a handler throws, the
 * error is dispatched to the app-level `onError` at the level of the failing
 * handler, and the promise chain *below* it resolves. A wrapping middleware
 * therefore never observes the rejection — it would only ever see a response
 * that Hono's built-in fallback had already turned into a plain-text 500.
 *
 * `onError` receives `(error, c)` and must return the Response to send.
 */
export async function handleApiError(error: unknown, c: Context<AppEnv>): Promise<Response> {
  const logger = c.get('logger');
  const requestId = c.get('requestId') ?? 'req_unknown';

  let appError: AppError;
  if (isAppError(error)) {
    appError = error;
  } else {
    const mapped = fromDatabaseError(error);
    if (mapped) {
      appError = mapped;
    } else {
      appError = new AppError('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
      logger?.error('unhandled error', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : undefined,
        request_id: requestId,
      });
    }
  }

  if (appError.code !== 'INTERNAL_ERROR' && appError.status >= 500) {
    logger?.error('request error', { code: appError.code, message: appError.message, ...appError.logFields });
  }

  applySecurityHeaders(c);

  const details: ApiErrorDetail[] | undefined = appError.details;
  return c.json(
    {
      success: false as const,
      error: {
        code: appError.code as ApiErrorCode,
        message: appError.message,
        ...(details && details.length ? { details } : {}),
      },
      meta: metaFor(c),
    },
    // Hono's status union does not include every code; the values come from
    // the shared ERROR_STATUS map so they are always valid HTTP statuses.
    ERROR_STATUS[appError.code] as 400,
  );
}

/** 404 for unmatched routes — same envelope as everything else. */
export function notFoundHandler(c: Context<AppEnv>) {
  return c.json(
    {
      success: false as const,
      error: { code: 'NOT_FOUND' as ApiErrorCode, message: 'This endpoint does not exist' },
      meta: metaFor(c),
    },
    404,
  );
}
