/**
 * Page — departments.
 *
 * The grid of department cards comes from the public catalogue API
 * (`GET /departments`), which only returns published departments.
 */
import { api } from '../core/api.js';
import { qs } from '../core/dom.js';
import { departmentCard } from '../components/cards.js';
import { emptyState } from '../components/empty-state.js';
import { pageError, setBusy } from './_shared.js';

export async function init({ signal }) {
  const host = qs('[data-departments-list]');
  if (!host) return;

  try {
    const departments = await api.get('/departments', { signal });

    host.replaceChildren(
      ...(departments?.length
        ? departments.map((department) => departmentCard(department))
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
