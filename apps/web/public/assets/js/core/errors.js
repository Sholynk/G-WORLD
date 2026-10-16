/**
 * Core — error types.
 *
 * The API answers every failure with the same envelope
 * (`{ success: false, error: { code, message, details? }, meta }`), so the
 * frontend has exactly one error type to reason about: `ApiError`. Pages can
 * branch on `code` (stable) instead of parsing messages (presentation).
 */

export class ApiError extends Error {
  /**
   * @param {object} options
   * @param {string} options.code    Stable machine code, e.g. `VALIDATION_ERROR`.
   * @param {string} options.message Human-readable message from the API.
   * @param {number} options.status  HTTP status.
   * @param {Array<{field?: string, message: string}>} [options.details]
   * @param {string} [options.requestId]
   */
  constructor({ code, message, status, details = [], requestId = null }) {
    super(message || 'Something went wrong.');
    this.name = 'ApiError';
    this.code = code || 'INTERNAL_ERROR';
    this.status = status || 500;
    this.details = details;
    this.requestId = requestId;
  }

  /** True when the caller needs to sign in again. */
  get isAuthError() {
    return this.code === 'UNAUTHENTICATED' || this.code === 'SESSION_EXPIRED';
  }

  /** True when retrying later is reasonable. */
  get isTransient() {
    return this.code === 'RATE_LIMITED' || this.code === 'DEPENDENCY_UNAVAILABLE';
  }

  /** Field-keyed messages, for rendering under form inputs. */
  get fieldErrors() {
    const map = new Map();
    for (const detail of this.details) {
      if (!detail?.field) continue;
      if (!map.has(detail.field)) map.set(detail.field, []);
      map.get(detail.field).push(detail.message);
    }
    return map;
  }
}

/** Message for anything thrown by non-API code (bugs, network failures). */
export function describeError(error) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return 'The G WORLD API is unreachable. Start it with `npm run dev:api`, then reload.';
  }
  return error?.message ?? 'Unexpected error.';
}
