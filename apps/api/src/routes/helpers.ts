/**
 * Route helpers — one success envelope, one pagination shape.
 *
 * Every handler ends with `ok(c, data)` or `okPage(c, …)`, which guarantees the
 * frontend's `core/api.js` can rely on `{ success, data, meta }` for every
 * endpoint without special cases.
 */
import type { AppContext } from '../env.js';
import { buildPaginationMeta, type PaginationMeta } from '@sholynk/shared';
import { metaFor } from '../middleware/error-handler.js';

export interface OkOptions {
  status?: 200 | 201 | 202;
  pagination?: PaginationMeta;
  notices?: string[];
  /** Extra JSON-safe meta fields (e.g. `{ total }` for a capped list). */
  meta?: Record<string, unknown>;
}

export function ok<T>(c: AppContext, data: T, options: OkOptions = {}) {
  return c.json(
    {
      success: true as const,
      data,
      meta: metaFor(c, {
        ...(options.pagination ? { pagination: options.pagination } : {}),
        ...(options.notices?.length ? { notices: options.notices } : {}),
        ...(options.meta ?? {}),
      }),
    },
    (options.status ?? 200) as 200,
  );
}

/**
 * Paginated collection response. Callers pass the raw filters plus the total row
 * count; the helper derives `total_pages`, `has_next` and `has_prev` so every
 * list behaves identically in the UI.
 */
export function okPage<T>(
  c: AppContext,
  items: T[],
  context: { page: number; perPage: number; total: number },
  notices?: string[],
) {
  const pagination = buildPaginationMeta(context.page, context.perPage, context.total);
  return ok(c, { items, pagination }, { pagination, notices });
}

export function created<T>(c: AppContext, data: T, notices?: string[]) {
  return ok(c, data, { status: 201, notices });
}

export function noContent(c: AppContext) {
  return c.body(null, 204);
}

/** Parses an integer path/query parameter with a safe fallback. */
export function intParam(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Optional boolean query flag: `?featured=true`, `?featured=1` and `?featured=`
 * are all understood; anything else is ignored rather than silently falsy.
 */
export function boolParam(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}
