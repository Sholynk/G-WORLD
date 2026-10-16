/**
 * Core — runtime configuration.
 *
 * Merges `window.GWORLD_CONFIG` (public/config.js, editable per deployment) with
 * hard-coded defaults, so a page never crashes because the config file is
 * missing or partially filled in.
 */

const defaults = {
  apiBaseUrl: '/api/v1',
  siteName: 'G WORLD',
  tagline: 'Learn the world. Prove it.',
  supportEmail: 'support@gworld.example',
  sessionCacheMs: 5000,
  pageSize: 12,
};

const runtime = typeof window !== 'undefined' ? window.GWORLD_CONFIG ?? {} : {};

export const config = Object.freeze({
  ...defaults,
  ...runtime,
});

/** Absolute URL for an API path (always same-origin in the browser). */
export function apiUrl(path) {
  const base = config.apiBaseUrl.replace(/\/$/, '');
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

/** Absolute URL for a page in this app. */
export function pageUrl(path) {
  return path.startsWith('/') ? path : `/${path}`;
}
