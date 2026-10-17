/**
 * Components — skeletons.
 *
 * The placeholder blocks that stand in for content while it is on its way.
 * They keep the shape of the real thing, so the page does not jump when the
 * data arrives.
 */
import { el } from '../core/dom.js';

const line = (variant = '') => el('span', { class: `skeleton skeleton--line ${variant}`.trim() });

/**
 * A skeleton that looks like a course card.
 * @returns {HTMLElement}
 */
export function skeletonCard() {
  return el('div', {
    class: 'skeleton--card',
    attrs: { 'aria-hidden': 'true' },
    children: [
      el('span', { class: 'skeleton skeleton--media' }),
      line('skeleton--line-tiny'),
      line(),
      line('skeleton--line-short'),
    ],
  });
}

/**
 * Fills a grid with card skeletons.
 *
 * @param {HTMLElement} host the element that holds the grid
 * @param {number} [count] how many skeletons to draw
 */
export function skeletonGrid(host, count = 3) {
  if (!host) return;
  host.replaceChildren(...Array.from({ length: count }, () => skeletonCard()));
  host.setAttribute('aria-busy', 'true');
}

/**
 * Fills a table container with row skeletons.
 *
 * @param {HTMLElement} host the element that holds the table
 * @param {number} [rows] how many rows to draw
 * @param {number} [columns] how many columns the table has
 */
export function skeletonTable(host, rows = 4, columns = 4) {
  if (!host) return;
  host.replaceChildren(
    el('div', { class: 'skeleton--table', attrs: { 'aria-hidden': 'true' } }, [
      ...Array.from({ length: rows }, () =>
        el('div', {
          class: 'skeleton--row',
          children: Array.from({ length: columns }, () => el('span', { class: 'skeleton skeleton--cell' })),
        }),
      ),
    ]),
  );
  host.setAttribute('aria-busy', 'true');
}

/**
 * Fills a container with a single block skeleton — used for the stat cards.
 *
 * @param {HTMLElement} host
 * @param {number} [count]
 */
export function skeletonStats(host, count = 3) {
  if (!host) return;
  host.replaceChildren(
    ...Array.from({ length: count }, () =>
      el('div', {
        class: 'stat',
        attrs: { 'aria-hidden': 'true' },
        children: [
          el('span', { class: 'skeleton skeleton--line' }),
          el('span', { class: 'skeleton skeleton--line skeleton--line-short' }),
        ],
      }),
    ),
  );
  host.setAttribute('aria-busy', 'true');
}
