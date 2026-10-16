/**
 * Components — loading skeletons.
 *
 * Every list starts as a skeleton, so the page has a stable shape instead of
 * jumping when data arrives, and never shows a bare "Loading…" that a slow
 * connection turns into an empty page. `aria-busy` marks the region for
 * assistive technology.
 */
import { el } from '../core/dom.js';

/** `<div class="skeleton skeleton--card">` — a single shimmer block. */
export function skeletonBlock({ height = null, width = null, radius = null } = {}) {
  return el('div', {
    class: 'skeleton',
    attrs: {
      'aria-hidden': 'true',
      ...(height ? { style: `height:${height}` } : {}),
      ...(width ? { style: `${height ? `height:${height};` : ''}width:${width}` } : {}),
      ...(radius ? { style: `${height ? `height:${height};` : ''}${width ? `width:${width};` : ''}border-radius:${radius}` } : {}),
    },
  });
}

/** Placeholder that mimics a course card. */
export function skeletonCard() {
  return el('article', {
    class: 'card card--skeleton',
    attrs: { 'aria-hidden': 'true' },
    children: [
      skeletonBlock({ height: '8rem', radius: 'var(--radius-md) var(--radius-md) 0 0' }),
      el('div', {
        class: 'card__body stack-sm',
        children: [
          skeletonBlock({ height: '0.75rem', width: '30%' }),
          skeletonBlock({ height: '1.25rem', width: '85%' }),
          skeletonBlock({ height: '0.75rem', width: '100%' }),
          skeletonBlock({ height: '0.75rem', width: '60%' }),
        ],
      }),
    ],
  });
}

/** `count` cards inside a grid, marked busy for the whole region. */
export function skeletonGrid(count = 6, tag = 'div') {
  return el(tag, {
    class: 'grid grid--cards',
    attrs: { 'aria-busy': 'true', 'aria-label': 'Loading content' },
    children: Array.from({ length: count }, () => skeletonCard()),
  });
}

/** Simple horizontal bars, for stats rows and detail pages. */
export function skeletonLines(count = 4) {
  return el('div', {
    class: 'stack-sm',
    attrs: { 'aria-busy': 'true', 'aria-label': 'Loading content' },
    children: Array.from({ length: count }, (_, index) =>
      skeletonBlock({ height: '0.9rem', width: index % 3 === 2 ? '55%' : '100%' }),
    ),
  });
}
