/**
 * Page — departments and subjects.
 *
 * Both endpoints return flat arrays, so this page renders them directly and uses
 * the department filter to re-render subjects client-side (the full list is
 * already in memory; there is no reason to re-fetch it).
 */
import { api } from '../core/api.js';
import { el, qs } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { emptyState } from '../components/empty-state.js';
import { pageError, setBusy } from './_shared.js';

function subjectCard(subject) {
  return el('article', {
    class: 'card',
    children: [
      el('div', {
        class: 'card__body stack-sm',
        children: [
          el('p', { class: 'card__eyebrow', text: subject.department_name ?? 'Subject' }),
          el('h3', {
            class: 'card__title',
            children: [
              el('a', {
                text: subject.name,
                attrs: { href: `/courses.html?subject=${encodeURIComponent(subject.slug)}` },
              }),
            ],
          }),
          subject.description ? el('p', { class: 'card__summary', text: subject.description }) : null,
          el('p', {
            class: 'card__meta',
            text: `${formatNumber(subject.course_count)} ${subject.course_count === 1 ? 'course' : 'courses'}`,
          }),
        ],
      }),
    ],
  });
}

export async function init({ signal }) {
  const departmentsHost = qs('[data-browse-departments]');
  const subjectsHost = qs('[data-subjects]');
  const filter = qs('[data-department-filter]');
  const countLabel = qs('[data-subject-count]');

  try {
    const [departments, subjects] = await Promise.all([
      api.get('/departments', { signal }),
      api.get('/subjects', { query: { per_page: 100, status: 'published' }, signal }),
    ]);

    departmentsHost.replaceChildren(
      ...departments.map((department) =>
        el('a', {
          class: 'department-tile',
          attrs: { href: `/courses.html?department=${encodeURIComponent(department.slug)}` },
          children: [
            el('span', { class: 'department-tile__icon', text: department.icon ?? '📘', attrs: { 'aria-hidden': 'true' } }),
            el('h3', { class: 'card__title mb-0', text: department.name }),
            department.tagline ? el('p', { class: 'card__summary', text: department.tagline }) : null,
            el('p', {
              class: 'department-tile__counts',
              text: `${formatNumber(department.subject_count)} subjects · ${formatNumber(department.course_count)} courses`,
            }),
          ],
        }),
      ),
    );
    setBusy(departmentsHost, false);

    filter.append(
      ...departments.map((department) =>
        el('option', { text: department.name, attrs: { value: department.slug } }),
      ),
    );

    const renderSubjects = () => {
      const wanted = filter.value;
      const visible = wanted ? subjects.filter((subject) => subject.department_slug === wanted) : subjects;
      countLabel.textContent = `${formatNumber(visible.length)} ${visible.length === 1 ? 'subject' : 'subjects'}`;
      subjectsHost.replaceChildren(
        ...(visible.length
          ? visible.map(subjectCard)
          : [emptyState({ title: 'No subjects here yet', message: 'This department has no published subjects.' })]),
      );
    };

    filter.addEventListener('change', renderSubjects);

    // `?department=technology` deep-links a filter from the home page.
    const requested = new URLSearchParams(window.location.search).get('department');
    if (requested && departments.some((department) => department.slug === requested)) {
      filter.value = requested;
    }
    renderSubjects();
    setBusy(subjectsHost, false);

    // Departments with no subject of their own still deserve a course list.
    if (!departments.length) {
      departmentsHost.replaceChildren(emptyState({ title: 'No departments yet' }));
    }
  } catch (error) {
    pageError(error, () => window.location.reload());
  }
}
