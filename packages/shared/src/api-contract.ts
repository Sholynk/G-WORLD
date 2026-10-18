/**
 * Sholynk Tech — one response envelope for the whole API.
 *
 * Success:
 *   { "success": true, "data": …, "meta": { "request_id": "req_…" } }
 * Error:
 *   { "success": false, "error": { "code": "VALIDATION_ERROR", "message": …,
 *      "details": [{ "field": "email", "message": "Invalid email address" }] },
 *     "meta": { "request_id": "req_…" } }
 *
 * A single shape means the frontend has exactly one place to handle failures
 * (`core/api.js`) and no route can accidentally leak a stack trace.
 */

export interface ResponseMeta {
  request_id: string;
  timestamp: string;
  /** Present on collections. */
  pagination?: PaginationMeta;
  /** Non-fatal information, e.g. "0 of 3 lessons published". */
  notices?: string[];
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  details?: ApiErrorDetail[];
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
  meta: ResponseMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorResponse;

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'SESSION_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'EMAIL_NOT_VERIFIED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_LOCKED',
  'INVALID_CREDENTIALS',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'DEPENDENCY_UNAVAILABLE',
  'FEATURE_DISABLED',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** HTTP status used for each error code. Keeps handlers free of magic numbers. */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  EMAIL_NOT_VERIFIED: 403,
  ACCOUNT_SUSPENDED: 403,
  ACCOUNT_LOCKED: 423,
  INVALID_CREDENTIALS: 401,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  DEPENDENCY_UNAVAILABLE: 503,
  FEATURE_DISABLED: 503,
  INTERNAL_ERROR: 500,
};

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

export function buildPaginationMeta(page: number, perPage: number, total: number): PaginationMeta {
  const safePerPage = perPage > 0 ? perPage : 1;
  const totalPages = Math.max(1, Math.ceil(total / safePerPage));
  return {
    page,
    per_page: perPage,
    total,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_prev: page > 1,
  };
}
