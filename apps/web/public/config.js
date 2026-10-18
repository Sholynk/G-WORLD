/**
 * Sholynk Tech — public runtime configuration.
 *
 * This file is served to the browser and is deliberately free of secrets: it
 * contains only values that are safe to be public (and that the API also
 * advertises at `GET /api/v1/meta`). Anything sensitive stays in Worker
 * bindings/secrets.
 *
 * Loaded before the page scripts so they can read `window.SHOLYNK_CONFIG`.
 * Editing it changes the deployed app without a rebuild, which is why it lives
 * in `public/` rather than being bundled.
 */
window.SHOLYNK_CONFIG = {
  /** The browser only ever talks to this same origin (proxied to the Worker). */
  apiBaseUrl: '/api/v1',
  siteName: 'Sholynk Tech',
  tagline: 'Insightful tech stories for builders, creators and curious minds.',
  editorEmail: 'sholynktech@gmail.com',
  /** Page size used by the homepage card grid. */
  pageSize: 10
};

/*
  The interface only animates when JavaScript is running, so the stylesheet
  can hide the elements it is going to reveal. The class is set here, in the
  head, before the first paint.
*/
document.documentElement.classList.add('js');
