/**
 * Page — my courses.
 *
 * `GET /me/enrollments` returns every enrolment with its course, progress and
 * next lesson (in `last_lesson_id`). Cancelling is available because the API
 * supports it, but it is confirmed first: the button is not a trap.
 */
import { api } from '../core/api.js';
import { el, qs, qsa } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { emptyState } from '../components/empty-state.js';
import { confirmAction } from '../components/modal.js';
import { toastError, toastSuccess } from '../components/toast.js';
import { fill, needSession, pageError, setBusy } from './_shared.js';
import { enrollmentCard } from './dashboard.js';

const FILTERS = new Set(['all', 'active', 'completed', 'cancelled']);

export async function init({ signal, session }) {
  const current = await needSession(session);
  if (!current) return;

  const listHost = qs('[data-enrolment-list]');
  const countLabel = qs('[data-enrolment-count]');
  const tabs = qsa('[data-filter]');

  let rows = [];
  let filter = 'all';

  function render() {
    const visible = filter === 'all' ? rows : rows.filter((row) => row.status === filter);
    countLabel.textContent = `${formatNumber(visible.length)} ${visible.length === 1 ? 'enrolment' : 'enrolments'}${
      filter === 'all' ? '' : ` with status “${filter}”`
    }`;

    listHost.replaceChildren(
      ...(visible.length
        ? visible.map((row) => {
            const card = enrollmentCard(row);
            const body = qs('.card__body', card);
            if (row.status === 'active' || row.status === 'completed') {
              body.append(
                el('div', {
                  class: 'cluster cluster--tight',
                  children: [
                    el('button', {
                      class: 'btn btn--sm btn--ghost',
                      text: 'Cancel enrolment',
                      attrs: { type: 'button' },
                      on: {
                        click: async () => {
                          const confirmed = await confirmAction({
                            title: 'Cancel this enrolment?',
                            body: 'Your lesson records are kept. You can enrol again later and your progress will still be here.',
                            confirmLabel: 'Cancel enrolment',
                            tone: 'danger',
                            onConfirm: async () => {
                              await api.delete(`/me/enrollments/${encodeURIComponent(row.id)}`);
                            },
                          });
                          if (!confirmed) return;
                          toastSuccess('Enrolment cancelled.');
                          await load();
                        },
                      },
                    }),
                  ],
                }),
              );
            }
            return card;
          })
        : [emptyState({ title: 'Nothing here', message: 'No enrolments match this filter.', icon: '🎓' })]),
    );
  }

  async function load() {
    setBusy(listHost, true);
    rows = await api.get('/me/enrollments', { signal });
    setBusy(listHost, false);
    render();
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const wanted = tab.dataset.filter;
      if (!FILTERS.has(wanted)) return;
      filter = wanted;
      for (const other of tabs) other.setAttribute('aria-selected', String(other === tab));
      render();
    });
  }

  try {
    await load();
  } catch (error) {
    pageError(error, () => load());
  }
}
