/**
 * Pages — shared helpers.
 *
 * Small pieces every page module needs: guarding a member-only page, rendering a
 * page-level error with a retry button, and turn-taking "busy" regions.
 */
import { qs } from '../core/dom.js';
import { describeError } from '../core/errors.js';
import { requireSession } from '../core/session.js';
import { renderError } from '../components/empty-state.js';

/**
 * Member pages call this first. It redirects to the sign-in page (carrying
 * `?next=`) when there is no session, so a signed-out visitor never sees a
 * half-rendered dashboard.
 */
export async function needSession(session) {
  if (session) return session;
  return requireSession();
}

/** Page-level failure in `[data-page-error]`, with an optional retry. */
export function pageError(error, retry = null) {
  const container = qs('[data-page-error]');
  if (!container) {
    console.error('[page]', error);
    return;
  }
  renderError(container, error, { onRetry: retry, describe: describeError });
}

/** Marks a region busy (skeletons already carry `aria-busy`, this keeps it honest). */
export function setBusy(node, busy) {
  node?.setAttribute('aria-busy', busy ? 'true' : 'false');
}

/**
 * Writes text into the first element matching `selector`, tolerating a missing
 * element so a template change never throws inside a render pass.
 */
export function fill(selector, text) {
  const node = typeof selector === 'string' ? qs(selector) : selector;
  if (!node) return null;
  node.textContent = text ?? '—';
  return node;
}

/** Hides/shows many selectors at once. */
export function toggle(selector, visible) {
  const node = typeof selector === 'string' ? qs(selector) : selector;
  if (!node) return null;
  node.hidden = !visible;
  return node;
}
