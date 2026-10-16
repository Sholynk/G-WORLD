/**
 * Components — empty and error states.
 *
 * A list that has no rows still has to say something useful, and a failed
 * request has to say what failed rather than leaving a blank panel. Both are
 * ordinary markup here so a page can drop them into any region.
 */
import { el } from '../core/dom.js';

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.message]
 * @param {string} [options.icon]
 * @param {{label: string, href?: string, onClick?: Function}} [options.action]
 */
export function emptyState({ title, message, action, icon = '📚' }) {
  return el('div', {
    class: 'empty-state',
    children: [
      el('p', { class: 'empty-state__icon', text: icon, attrs: { 'aria-hidden': 'true' } }),
      el('h3', { class: 'empty-state__title', text: title }),
      message ? el('p', { class: 'empty-state__message', text: message }) : null,
      action
        ? el('a', {
            class: 'btn btn--primary',
            text: action.label,
            attrs: { href: action.href ?? '#' },
            on: action.onClick ? { click: action.onClick } : {},
          })
        : null,
    ],
  });
}

/**
 * Error panel. Always shows what we know: the API message, and the request id
 * when the failure came from the API, because that is what support can trace.
 *
 * @param {object} options
 * @param {string} [options.title]
 * @param {string} [options.message]
 * @param {string|null} [options.requestId]
 * @param {{label?: string, onClick: Function}} [options.retry]
 */
export function errorState({ title = 'Something went wrong', message, requestId = null, retry = null }) {
  return el('div', {
    class: 'empty-state empty-state--error',
    attrs: { role: 'alert' },
    children: [
      el('p', { class: 'empty-state__icon', text: '⚠️', attrs: { 'aria-hidden': 'true' } }),
      el('h3', { class: 'empty-state__title', text: title }),
      message ? el('p', { class: 'empty-state__message', text: message }) : null,
      requestId ? el('p', { class: 'muted mono', text: `Request ${requestId}` }) : null,
      retry
        ? el('button', {
            class: 'btn',
            text: retry.label ?? 'Try again',
            attrs: { type: 'button' },
            on: { click: retry.onClick },
          })
        : null,
    ],
  });
}

/** Renders `errorState()` for any thrown value, retrying with `onRetry`. */
export function renderError(container, error, { onRetry = null, describe } = {}) {
  const message = describe
    ? describe(error)
    : error?.message ?? 'The request could not be completed.';
  container.replaceChildren(
    errorState({
      title: error?.code === 'DEPENDENCY_UNAVAILABLE' ? 'The API is not reachable' : 'This could not be loaded',
      message,
      requestId: error?.requestId ?? null,
      retry: onRetry ? { label: 'Try again', onClick: onRetry } : null,
    }),
  );
  return container;
}
