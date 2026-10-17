/**
 * Page — subjects.
 *
 * Two public reads: the departments (to fill the filter) and the subjects
 * themselves. The filter is applied in the browser, so choosing a department is
 * instant and does not need another request.
 */
import { api } from '../core/api.js';
import { el, qs } from '../core/dom.js';
import { subjectCard } from '../components/cards.js';
import { emptyState } from '../components/empty-state.js';
import { pageError, setBusy } from './_shared.js';

export async function init({ signal }) {
  const host = qs('[data-subjects-list]');
  const filter = qs('[data-department-filter]');
  if (!host) return;

  try {
    const [departments, subjects] = await Promise.all([
      api.get('/departments', { signal }),
      api.get('/subjects', { signal }),
    ]);

    // The select is the template's filter: "All departments" is the default.
    for (const department of departments ?? []) {
      filter.append(el('option', { text: department.name, attrs: { value: department.slug } }));
    }

    const render = () => {
      const selected = filter.value;
      const visible = (subjects ?? []).filter(
        (subject) => !selected || subject.department_slug === selected,
      );

      host.replaceChildren(
        ...(visible.length
          ? visible.map((subject) => subjectCard(subject))
          : [
              emptyState({
                title: 'No subjects here yet',
                message: 'Try another department, or browse the courses instead.',
                action: { label: 'Browse courses', href: '/courses.html' },
              }),
            ]),
      );
      setBusy(host, false);
    };

    filter.addEventListener('change', render);
    render();
  } catch (error) {
    setBusy(host, false);
    pageError(error, () => init({ signal }));
  }
}
