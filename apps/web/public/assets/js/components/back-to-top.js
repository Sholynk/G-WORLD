/**
 * Components — back to top.
 *
 * A small button that appears once the visitor has scrolled down and takes
 * them back to the top of the page.
 */
import { el } from '../core/dom.js';

const SHOW_AFTER = 480;

/**
 * Adds the back-to-top button to the page.
 *
 * @param {object} [options]
 * @param {number} [options.threshold] pixels of scroll before it appears
 * @returns {HTMLElement|null}
 */
export function mountBackToTop({ threshold = SHOW_AFTER } = {}) {
  if (typeof document === 'undefined') return null;
  if (document.querySelector('.back-to-top')) return null;

  const button = el('button', {
    class: 'back-to-top',
    attrs: { type: 'button', 'aria-label': 'Back to top' },
    children: [el('span', { attrs: { 'aria-hidden': 'true' }, text: '↑' })],
  });

  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.body.append(button);

  const update = () => {
    const offset = window.scrollY ?? document.documentElement.scrollTop ?? 0;
    button.classList.toggle('is-visible', offset > threshold);
  };

  window.addEventListener('scroll', update, { passive: true });
  update();

  return button;
}
