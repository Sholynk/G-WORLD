/**
 * Page — search.
 *
 * `GET /search?q=` returns mixed results (`{query, items, total}`) where each
 * item carries its own `type`, `subtitle` and `url`. The dropdown filters that
 * one list client-side rather than re-querying: the API already searched every
 * catalog table.
 */
import { api } from '../core/api.js';
import { el, qs, queryParam } from '../core/dom.js';
import { formatNumber, humanize } from '../core/format.js';
import { emptyState } from '../components/empty-state.js';
import { skeletonLines } from '../components/skeletons.js';
import { pageError, setBusy } from './_shared.js';

export async function init({ signal } = {}) {
  const form = qs('[data-search-form]');
  const input = qs('#q');
  const typeSelect = form.elements.type;
  const resultsHost = qs('[data-search-results]');
  const countLabel = qs('[data-search-count]');

  let results = [];

  function render() {
    const type = typeSelect.value;
    const visible = type === 'all' ? results : results.filter((item) => item.type === type);

    countLabel.textContent = `${formatNumber(visible.length)} ${visible.length === 1 ? 'result' : 'results'}${
      input.value ? ` for “${input.value}”` : ''
    }`;

    if (!visible.length) {
      resultsHost.replaceChildren(
        emptyState({
          title: results.length ? 'Nothing of that type' : 'No matches',
          message: results.length
            ? 'Try “Everything”, or a different type.'
            : 'Try a shorter term — for example “css”, “data” or “business”.',
          icon: '🔍',
        }),
      );
      return;
    }

    // Group by type so the page reads as a catalogue, not a dump.
    const groups = new Map();
    for (const item of visible) {
      if (!groups.has(item.type)) groups.set(item.type, []);
      groups.get(item.type).push(item);
    }

    resultsHost.replaceChildren(
      ...[...groups.entries()].map(([type, items]) =>
        el('section', {
          class: 'stack-sm',
          children: [
            el('h2', { class: 'card__title', text: `${humanize(type)}s` }),
            el('ul', {
              class: 'list-plain stack-sm',
              children: items.map((item) =>
                el('li', {
                  class: 'card',
                  children: [
                    el('div', {
                      class: 'card__body stack-sm',
                      children: [
                        el('p', { class: 'card__eyebrow', text: humanize(type) }),
                        el('h3', { class: 'card__title', children: [el('a', { text: item.title, attrs: { href: item.url } })] }),
                        item.subtitle ? el('p', { class: 'card__summary', text: item.subtitle }) : null,
                      ],
                    }),
                  ],
                }),
              ),
            }),
          ],
        }),
      ),
    );
  }

  async function run(term) {
    setBusy(resultsHost, true);
    resultsHost.replaceChildren(skeletonLines(6));
    const data = await api.get('/search', { query: { q: term, limit: 30 }, signal });
    results = data.items ?? [];
    setBusy(resultsHost, false);
    render();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const term = input.value.trim();
    if (term.length < 2) {
      countLabel.textContent = 'Type at least two characters.';
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('q', term);
    window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}`);
    run(term).catch((error) => pageError(error, () => run(term)));
  });

  typeSelect.addEventListener('change', render);

  const initial = queryParam('q');
  if (initial) {
    input.value = initial;
    try {
      await run(initial);
    } catch (error) {
      pageError(error, () => run(initial));
    }
  } else {
    countLabel.textContent = 'Search the whole catalogue — courses, lessons, subjects and departments.';
  }
}
