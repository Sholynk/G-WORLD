/**
 * G WORLD — public runtime configuration.
 *
 * This file is served to the browser and is deliberately free of secrets: it
 * contains only values that are safe to be public (and that the API also
 * advertises at `GET /api/v1/meta`). Anything sensitive stays in Worker
 * bindings/secrets.
 *
 * Loaded before the module scripts so pages can read `window.GWORLD_CONFIG`.
 * Editing it changes the deployed app without a rebuild, which is why it lives
 * in `public/` rather than being bundled.
 */
window.GWORLD_CONFIG = {
  /** The browser only ever talks to this same origin. */
  apiBaseUrl: '/api/v1',
  siteName: 'G WORLD',
  tagline: 'Learn the world. Prove it.',
  supportEmail: 'support@gworld.example',
  /**
   * Cache lifetime for `GET /api/v1/me` in milliseconds. Keeps every page from
   * re-requesting the session while still showing a status change within a
   * couple of seconds.
   */
  sessionCacheMs: 5000,
  /** Page size used by catalog lists. */
  pageSize: 12,
};

/*
  The interface only animates when JavaScript is running, so the stylesheet
  can hide the elements it is going to reveal. The class is set here, in the
  head, before the first paint.
*/
document.documentElement.classList.add('js');
