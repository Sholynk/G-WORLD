/**
 * Page — error pages (403, 404, 500, offline).
 *
 * One module for the four static error documents. Each is a real page served
 * with the right status code by the host, so this script only adds behaviour the
 * static HTML cannot express: a retry button, and the request id from the URL
 * when a failed API call redirected here with one.
 */
import { qs, queryParam } from '../core/dom.js';
import { fill, toggle } from './_shared.js';

export async function init() {
  const requestId = queryParam('request_id');
  if (requestId) {
    const host = qs('[data-request-id]');
    if (host) host.textContent = `Request ${requestId}`;
  }

  const reloadButton = qs('[data-reload]');
  if (reloadButton) {
    reloadButton.addEventListener('click', () => window.location.reload());
  }

  // Browsers fire `online` when connectivity returns; make that useful rather
  // than leaving the visitor to guess.
  window.addEventListener('online', () => {
    const offlineNotice = qs('[data-offline-notice]');
    if (offlineNotice) offlineNotice.hidden = false;
  });
}
