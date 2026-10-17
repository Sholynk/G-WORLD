/**
 * Page — courses.
 *
 * The catalogue of published courses. The filters (department, subject, level,
 * status) and the search box narrow the list in the browser, so they feel
 * instant; the URL keeps the chosen department so a filtered list can be
 * shared.
 */
import { api } from '../core/api.js';
import { debounce, el, qs, queryParam } from '../core/dom.js';
import { courseCard } from '../components/cards.js';
import { emptyState } from '../components/empty-state.js';
import { enrolAction, pageError, setBusy } from './_shared.js';
import { skeletonGrid } from '../components/skeleton.js';

export async function init({ signal, session }) {
  const host = qs('[data-courses-list]');
  const departmentSelect = qs('[data-course-department]');
  const subjectSelect = qs('[data-course-subject]');
  const levelSelect = qs('[data-course-level]');
  const statusSelect = qs('[data-course-status]');
  const searchInput = qs('[data-course-search]');
  if (!host) return;

  skeletonGrid(host, 3);

  try {
    const [departments, subjects, page, enrolments] = await Promise.all([
      api.get('/departments', { signal }),
      api.get('/subjects', { signal }),
      api.get('/courses', { signal, query: { per_page: 48 } }),
      session?.user ? api.get('/me/enrollments', { signal }).catch(() => []) : Promise.resolve([]),
    ]);

    for (const department of departments ?? []) {
      departmentSelect.append(el('option', { text: department.name, attrs: { value: department.slug } }));
    }

    const allSubjects = subjects ?? [];
    for (const subject of allSubjects) {
      subjectSelect.append(el('option', { text: subject.name, attrs: { value: subject.slug } }));
    }

    // The learner-only statuses only make sense for a signed-in visitor.
    if (session?.user) {
      statusSelect.append(el('option', { text: 'In progress', attrs: { value: 'in-progress' } }));
      statusSelect.append(el('option', { text: 'Completed', attrs: { value: 'completed' } }));
    }

    const courses = page?.items ?? [];
    const onEnroll = enrolAction(session);

    /** The learner's own progress, keyed by course id. */
    const progress = new Map(
      (enrolments ?? []).map((row) => [row.course?.id ?? row.course_id, row.status]),
    );

    /** Keeps the subject list in step with the chosen department. */
    const syncSubjects = () => {
      const department = departmentSelect.value;
      const previous = subjectSelect.value;
      subjectSelect.replaceChildren(el('option', { text: 'All subjects', attrs: { value: '' } }));
      for (const subject of allSubjects) {
        if (department && subject.department_slug !== department) continue;
        subjectSelect.append(el('option', { text: subject.name, attrs: { value: subject.slug } }));
      }
      subjectSelect.value = previous;
    };

    const render = () => {
      const department = departmentSelect.value;
      const subject = subjectSelect.value;
      const level = levelSelect.value;
      const status = statusSelect.value;
      const term = (searchInput?.value ?? '').trim().toLowerCase();

      const visible = courses.filter((course) => {
        if (department && course.department?.slug !== department) return false;
        if (subject && course.subject?.slug !== subject) return false;
        if (level && course.difficulty !== level) return false;
        if (status === 'open' && course.enrollment_open === false) return false;
        if (status === 'in-progress' && progress.get(course.id) !== 'active') return false;
        if (status === 'completed' && progress.get(course.id) !== 'completed') return false;
        if (!term) return true;
        return (
          course.title.toLowerCase().includes(term) ||
          (course.summary ?? '').toLowerCase().includes(term) ||
          (course.subject?.name ?? '').toLowerCase().includes(term)
        );
      });

      host.replaceChildren(
        ...(visible.length
          ? visible.map((course, index) => courseCard(course, { actionLabel: 'Enroll', onEnroll, index }))
          : [
              emptyState({
                title: 'No courses match',
                message: 'Try another department or subject, or clear the search box.',
                action: { label: 'Browse departments', href: '/departments.html' },
              }),
            ]),
      );
      setBusy(host, false);
    };

    // A department can be linked to directly: /courses.html?department=design
    const linked = queryParam('department');
    if (linked && departments?.some((department) => department.slug === linked)) {
      departmentSelect.value = linked;
    }
    syncSubjects();

    departmentSelect.addEventListener('change', () => {
      syncSubjects();
      render();
    });
    subjectSelect.addEventListener('change', render);
    levelSelect.addEventListener('change', render);
    statusSelect.addEventListener('change', render);
    searchInput?.addEventListener('input', debounce(render, 200));
    render();
  } catch (error) {
    setBusy(host, false);
    pageError(error, () => init({ signal, session }));
  }
}
