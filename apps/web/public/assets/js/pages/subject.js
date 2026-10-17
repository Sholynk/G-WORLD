/**
 * Page — one subject.
 *
 * The subject and its courses come from `GET /subjects/:slug`. The page shows
 * the department as a tag, the subject name as the heading and a three-column
 * grid of course cards.
 */
import { api } from '../core/api.js';
import { qs, queryParam } from '../core/dom.js';
import { courseCard } from '../components/cards.js';
import { emptyState } from '../components/empty-state.js';
import { enrolAction, pageError, setBusy } from './_shared.js';

export async function init({ signal, session }) {
  const slug = queryParam('subject');
  const nameHost = qs('[data-subject-name]');
  const departmentHost = qs('[data-subject-department]');
  const descriptionHost = qs('[data-subject-description]');
  const courseHost = qs('[data-subject-courses]');
  if (!courseHost) return;

  if (!slug) {
    nameHost.textContent = 'Subject not found';
    descriptionHost.textContent = 'Pick a subject from the list to see its courses.';
    courseHost.replaceChildren(
      emptyState({
        title: 'No subject selected',
        message: 'Choose a subject to see the courses inside it.',
        action: { label: 'Browse subjects', href: '/subjects.html' },
      }),
    );
    setBusy(courseHost, false);
    return;
  }

  try {
    const data = await api.get(`/subjects/${encodeURIComponent(slug)}`, { signal });
    const subject = data.subject ?? {};

    document.title = `${subject.name ?? 'Subject'} · G WORLD`;
    nameHost.textContent = subject.name ?? 'Subject';
    departmentHost.textContent = subject.department_name ?? 'Subject';
    descriptionHost.textContent =
      subject.description ?? 'The courses in this subject, each with lessons, quizzes and a certificate.';

    const courses = data.courses ?? [];
    const onEnroll = enrolAction(session);
    courseHost.replaceChildren(
      ...(courses.length
        ? courses.map((course) => courseCard(course, { actionLabel: 'Enroll', onEnroll }))
        : [
            emptyState({
              title: 'No courses in this subject yet',
              message: 'Check back soon, or look at another subject.',
              action: { label: 'Browse subjects', href: '/subjects.html' },
            }),
          ]),
    );
    setBusy(courseHost, false);
  } catch (error) {
    setBusy(courseHost, false);
    nameHost.textContent = 'Subject not found';
    descriptionHost.textContent = 'This subject may have been renamed or removed.';
    pageError(error, () => init({ signal }));
  }
}
