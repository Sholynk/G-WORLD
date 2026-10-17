/**
 * Page — home.
 *
 * The home page is mostly static: the hero, the "How learning flows" row and
 * the footer are in the HTML. The only dynamic part is the row of three
 * department cards, which comes from the public catalogue API.
 */
import { api } from '../core/api.js';
import { qs } from '../core/dom.js';
import { departmentCard } from '../components/cards.js';
import { emptyState } from '../components/empty-state.js';
import { pageError, setBusy } from './_shared.js';

export async function init({ signal }) {
  const host = qs('[data-home-departments]');
  if (!host) return;

  try {
    const departments = await api.get('/departments', { signal });
    const visible = (departments ?? []).slice(0, 3);

    host.replaceChildren(
      ...(visible.length
        ? visible.map((department) => departmentCard(department))
        : [
            emptyState({
              title: 'No departments published yet',
              message: 'The catalogue is being prepared — check back soon.',
            }),
          ]),
    );
    setBusy(host, false);
  } catch (error) {
    setBusy(host, false);
    pageError(error, () => init({ signal }));
  }
}
