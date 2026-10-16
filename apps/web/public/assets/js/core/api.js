/**
 * Core — API client.
 *
 * One place that knows how to talk to the Worker:
 *   - same-origin requests with cookies (`credentials: 'same-origin'`), so the
 *     HttpOnly session cookie is sent and no CORS preflight is needed;
 *   - the CSRF header for unsafe methods, copied from the readable `gw_csrf`
 *     cookie the API sets alongside the session (double submit);
 *   - envelope unwrapping: resolves with `data`, rejects with `ApiError`;
 *   - a request timeout, so a hung dev server fails visibly instead of hanging
 *     the page forever.
 *
 * Nothing here formats or renders — components do that.
 */
import { apiUrl } from './config.js';
import { ApiError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Reads a cookie the API deliberately left readable (CSRF only). */
export function readCookie(name) {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * Performs an API request.
 *
 * @param {string} method
 * @param {string} path          Path below the API base, e.g. `/courses`.
 * @param {object} [options]
 * @param {object} [options.query]  Query string values; empty ones are dropped.
 * @param {object|FormData} [options.body]
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<any>} the `data` member of the success envelope
 */
export async function request(method, path, options = {}) {
  const url = `${apiUrl(path)}${buildQuery(options.query)}`;
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  let body;
  if (options.body !== undefined && options.body !== null) {
    if (isFormData) body = options.body;
    else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
  }

  if (UNSAFE_METHODS.has(method)) {
    const csrf = readCookie('gw_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (options.signal) options.signal.addEventListener('abort', () => controller.abort(), { once: true });

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error?.name === 'AbortError') {
      throw new ApiError({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'The request timed out. Is the API still running?',
        status: 0,
      });
    }
    throw new ApiError({
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'The G WORLD API is unreachable.',
      status: 0,
    });
  }
  clearTimeout(timeout);

  if (response.status === 204) return null;

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError({
        code: 'INTERNAL_ERROR',
        message: 'The API returned a response that is not JSON.',
        status: response.status,
      });
    }
  }

  if (!response.ok || payload?.success === false) {
    throw new ApiError({
      code: payload?.error?.code ?? 'INTERNAL_ERROR',
      message: payload?.error?.message ?? `Request failed with status ${response.status}.`,
      status: response.status,
      details: payload?.error?.details ?? [],
      requestId: payload?.meta?.request_id ?? null,
    });
  }

  return payload?.data ?? null;
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  put: (path, body, options) => request('PUT', path, { ...options, body }),
  delete: (path, options) => request('DELETE', path, options),
};
