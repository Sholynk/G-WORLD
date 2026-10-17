/**
 * Page — student dashboard.
 *
 * One request to `/me/dashboard` fills the page: the three totals and the
 * courses the learner can continue. The module and lesson labels come from the
 * enrolment details, which are fetched for the two cards that are shown.
 */
import { api } from '../core/api.js';
import { el, qs } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { enrolledCourseCard } from '../components/cards.js';
import { emptyState } from '../components/empty-state.js';
import { needSession, pageError, setBusy } from './_shared.js';

export async function init({ signal, session }) {
  const current = await needSession(session);
  if (!current) return; // redirecting to sign-in

  const name =
    current.user?.profile?.display_name ?? current.user?.profile?.full_name ?? current.user?.email ?? 'learner';
  const greeting = qs('[data-dashboard-greeting]');
  if (greeting) greeting.textContent = `Welcome back, ${name}`;

  const statHost = qs('[data-dashboard-stats]');
  const continueHost = qs('[data-dashboard-continue]');

  try {
    const data = await api.get('/me/dashboard', { signal });
    const stats = data.stats ?? {};

    statHost.replaceChildren(
      ...[
        ['Courses enrolled', stats.enrolled],
        ['Lessons completed', stats.lessonsCompleted],
        ['Certificates earned', stats.certificates],
      ].map(([label, value]) =>
        el('div', {
          class: 'stat',
          children: [
            el('p', { class: 'stat__value', text: formatNumber(value ?? 0) }),
            el('p', { class: 'stat__label', text: label }),
          ],
        }),
      ),
    );
    setBusy(statHost, false);

    // Two cards, as the template shows.
    const active = (data.courses?.active ?? []).slice(0, 2);
    const details = await Promise.all(
      active.map((enrollment) =>
        api.get(`/me/enrollments/${encodeURIComponent(enrollment.id)}`, { signal }).catch(() => null),
      ),
    );

    continueHost.replaceChildren(
      ...(active.length
        ? active.map((enrollment, index) => enrolledCourseCard(enrollment, details[index]))
        : [
            emptyState({
              title: 'Nothing in progress',
              message: 'Enrol in a course and your next lesson will appear here.',
              action: { label: 'Browse courses', href: '/courses.html' },
            }),
          ]),
    );
    setBusy(continueHost, false);
  } catch (error) {
    setBusy(statHost, false);
    setBusy(continueHost, false);
    pageError(error, () => init({ signal, session: current }));
  }
}
