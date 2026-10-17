/**
 * Page — my courses.
 *
 * `GET /me/enrollments` returns every enrolment with its course and progress.
 * The enrolment details add the module and lesson the learner is on, which is
 * what the enrolled-course card shows.
 */
import { api } from '../core/api.js';
import { qs } from '../core/dom.js';
import { enrolledCourseCard } from '../components/cards.js';
import { emptyState } from '../components/empty-state.js';
import { needSession, pageError, setBusy } from './_shared.js';
import { skeletonGrid } from '../components/skeleton.js';

export async function init({ signal, session }) {
  const current = await needSession(session);
  if (!current) return;

  const host = qs('[data-enrolment-list]');
  if (!host) return;

  skeletonGrid(host, 3);

  try {
    const enrollments = await api.get('/me/enrollments', { signal });
    const rows = enrollments ?? [];

    const details = await Promise.all(
      rows.slice(0, 12).map((enrollment) =>
        api.get(`/me/enrollments/${encodeURIComponent(enrollment.id)}`, { signal }).catch(() => null),
      ),
    );

    host.replaceChildren(
      ...(rows.length
        ? rows.map((enrollment, index) => enrolledCourseCard(enrollment, details[index], index))
        : [
            emptyState({
              title: 'No courses yet',
              message: 'Enrol in a course and it will show up here with your progress.',
              action: { label: 'Browse courses', href: '/courses.html' },
            }),
          ]),
    );
    setBusy(host, false);
  } catch (error) {
    setBusy(host, false);
    pageError(error, () => init({ signal, session: current }));
  }
}
