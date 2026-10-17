/**
 * Components — loading states.
 *
 * Two small pieces:
 *
 *   · `setButtonLoading()` puts a button into its "working" state, so a form
 *     that is being submitted says so;
 *   · `startTopLoader()` shows the thin bar at the top of the page while the
 *     page is still settling.
 */
import { el } from '../core/dom.js';

/**
 * Puts a button into (or out of) its loading state.
 *
 * @param {HTMLElement|null} button
 * @param {boolean} loading
 * @param {string} [label] the label to restore when the work is done
 */
export function setButtonLoading(button, loading, label) {
  if (!button) return;

  if (loading) {
    button.dataset.previousMarkup = button.innerHTML;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    if (label) button.textContent = label;
    return;
  }

  button.classList.remove('is-loading');
  button.removeAttribute('aria-busy');
  button.disabled = false;
  if (label) button.textContent = label;
  else if (button.dataset.previousMarkup !== undefined) {
    button.innerHTML = button.dataset.previousMarkup;
    delete button.dataset.previousMarkup;
  }
}

/**
 * Shows the thin progress bar at the top of the page and hides it again once
 * the page has settled.
 *
 * @param {number} [timeout] milliseconds after which the bar gives up
 * @returns {{finish: () => void}|null}
 */
export function startTopLoader(timeout = 4000) {
  if (typeof document === 'undefined' || !document.body) return null;

  const existing = document.querySelector('.top-loader');
  if (existing) return { finish: () => existing.classList.add('is-done') };

  const loader = el('div', { class: 'top-loader', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { class: 'top-loader__bar' }),
  ]);
  document.body.append(loader);

  const bar = loader.querySelector('.top-loader__bar');
  if (bar) bar.style.width = '35%';

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (bar) bar.style.width = '100%';
    loader.classList.add('is-done');
    window.setTimeout(() => loader.remove(), 400);
  };

  // A page that is already loaded does not need the bar at all.
  if (document.readyState === 'complete') {
    finish();
    return { finish };
  }

  window.setTimeout(finish, timeout);
  window.addEventListener('load', finish, { once: true });

  return { finish };
}
