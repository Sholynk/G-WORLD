/**
 * Components — pagination.
 *
 * The API returns `page`, `per_page` and `total`; this renders the controls and
 * reports the state in words ("Page 2 of 5 · 47 courses") so the count is not
 * only implied by button states.
 */
import { el, qs } from '../core/dom.js';
import { formatNumber, pluralize } from '../core/format.js';

export function pagination({ page, perPage, total, onPage, itemNoun = 'item' }) {
  const pages = Math.max(1, Math.ceil((total ?? 0) / (perPage || 1)));
  const current = Math.min(Math.max(1, page ?? 1), pages);

  const nav = el('nav', {
    class: 'pagination',
    attrs: { 'aria-label': `${itemNoun} pages` },
    children: [
      el('button', {
        class: 'btn btn--sm',
        text: 'Previous',
        attrs: { type: 'button', ...(current <= 1 ? { disabled: '' } : {}) },
        on: { click: () => onPage(current - 1) },
      }),
      el('p', {
        class: 'pagination__status',
        text: `Page ${current} of ${pages} · ${pluralize(total ?? 0, itemNoun)}`,
      }),
      el('button', {
        class: 'btn btn--sm',
        text: 'Next',
        attrs: { type: 'button', ...(current >= pages ? { disabled: '' } : {}) },
        on: { click: () => onPage(current + 1) },
      }),
    ],
  });

  // Numbered shortcuts only when there is room for them to be useful.
  if (pages > 2 && pages <= 9) {
    const numbers = el('div', {
      class: 'cluster cluster--tight',
      children: Array.from({ length: pages }, (_, index) =>
        el('button', {
          class: `btn btn--sm${index + 1 === current ? ' btn--primary' : ''}`,
          text: formatNumber(index + 1),
          attrs: {
            type: 'button',
            ...(index + 1 === current ? { 'aria-current': 'page' } : {}),
          },
          on: { click: () => onPage(index + 1) },
        }),
      ),
    });
    nav.insertBefore(numbers, qs('.pagination__status', nav));
  }

  return nav;
}

/** Renders pagination into `[data-pagination]`, or clears it when there is one page. */
export function renderPagination(container, options) {
  if (!container) return;
  const { total, perPage } = options;
  if (!total || total <= perPage) {
    container.replaceChildren();
    return container;
  }
  container.replaceChildren(pagination({ ...options }));
  return container;
}
