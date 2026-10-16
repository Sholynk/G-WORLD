/**
 * Admin pages — shared guard and helpers.
 *
 * The guard here is a *convenience*, not a security boundary: hiding the admin
 * navigation only stops an honest user from wandering into a page that would
 * fail. Every request below is authorised again by the API, which checks the
 * session's permissions on the server. A client-side redirect never protected
 * anything and is not treated as if it did.
 */
import { getSession, isStaff } from '../../core/session.js';
import { formatNumber } from '../../core/format.js';

/** Resolves the session, bouncing visitors to sign-in and non-staff to 403. */
export async function requireStaff(session) {
  const current = session ?? (await getSession().catch(() => null));
  if (!current) {
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    window.location.assign(`/login.html?next=${next}`);
    return null;
  }
  if (!isStaff(current)) {
    window.location.assign('/403.html');
    return null;
  }
  return current;
}

/** `"Page 2 of 5 · 47 students"` — used by every paginated admin table. */
export function describePage(pagination, noun = 'row') {
  if (!pagination) return '';
  return `Page ${pagination.page} of ${pagination.total_pages} · ${formatNumber(pagination.total)} ${
    pagination.total === 1 ? noun : `${noun}s`
  }`;
}

/** Reads a filter form into an API query object, dropping empty values. */
export function filterValues(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const query = {};
  for (const [key, value] of Object.entries(values)) {
    const text = String(value ?? '').trim();
    if (text) query[key] = text;
  }
  return query;
}

/** Shows a short status line under a toolbar (used after a bulk refresh). */
export function setStatus(selector, message, tone = '') {
  const node = document.querySelector(selector);
  if (!node) return;
  node.textContent = message;
  node.className = `subtle${tone ? ` form-status--${tone}` : ''}`;
}
