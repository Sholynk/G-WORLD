/**
 * Components — toasts.
 *
 * Transient feedback for actions (enrolled, saved, signed out). Non-modal by
 * design: a toast never blocks the page and never steals focus, so it cannot
 * trap a keyboard user. Errors stay long enough to be read; `aria-live` tells a
 * screen reader what happened.
 */
import { el, qs } from '../core/dom.js';

const DEFAULT_TIMEOUT = 5200;

function region() {
  let node = qs('[data-toast-region]');
  if (!node) {
    node = el('div', {
      class: 'toast-region',
      attrs: { 'data-toast-region': '', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' },
    });
    document.body.append(node);
  }
  return node;
}

/**
 * Shows a toast.
 *
 * @param {object|string} options
 * @param {string} [options.title]
 * @param {string} [options.message]
 * @param {'info'|'success'|'warning'|'error'} [options.tone]
 */
export function toast(options) {
  const settings = typeof options === 'string' ? { message: options } : options ?? {};
  const tone = settings.tone ?? 'info';
  const message = settings.message ?? settings.title ?? '';

  const node = el('div', {
    class: `toast toast--${tone}`,
    attrs: { role: tone === 'error' ? 'alert' : 'status' },
    children: [
      settings.title ? el('p', { class: 'toast__title', text: settings.title }) : null,
      message ? el('p', { class: 'toast__message', text: message }) : null,
      el('button', {
        class: 'toast__close',
        text: '×',
        attrs: { type: 'button', 'aria-label': 'Dismiss notification' },
        on: { click: () => node.remove() },
      }),
    ],
  });

  region().append(node);
  // Announce, then fade out. Hovering pauses dismissal so a long message can be read.
  let timer = setTimeout(() => node.remove(), settings.timeoutMs ?? DEFAULT_TIMEOUT);
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', () => {
    timer = setTimeout(() => node.remove(), 1800);
  });
  return node;
}

export const toastSuccess = (message, title) => toast({ tone: 'success', message, title });
export const toastError = (message, title) => toast({ tone: 'error', message, title });
export const toastWarning = (message, title) => toast({ tone: 'warning', message, title });
