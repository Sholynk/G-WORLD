/**
 * Page — home.
 *
 * Four independent reads (`/stats`, `/departments`, `/courses/featured`,
 * `/courses?sort=newest`) fill four regions. They run in parallel and each
 * region fails on its own: a flaky stats endpoint must not blank the catalogue.
 */
import { api } from '../core/api.js';
import { el, qs } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { courseCard } from '../components/course-card.js';
import { emptyState } from '../components/empty-state.js';
import { pageError, setBusy } from './_shared.js';

function departmentTile(department) {
  return el('a', {
    class: 'department-tile',
    attrs: { href: `/courses.html?department=${encodeURIComponent(department.slug)}` },
    children: [
      el('span', { class: 'department-tile__icon', text: department.icon ?? '📘', attrs: { 'aria-hidden': 'true' } }),
      el('h3', { class: 'card__title mb-0', text: department.name }),
      department.tagline ? el('p', { class: 'card__summary', text: department.tagline }) : null,
      el('p', {
        class: 'department-tile__counts',
        text: `${formatNumber(department.course_count)} courses · ${formatNumber(department.lesson_count)} lessons`,
      }),
    ],
  });
}

async function loadStats(signal) {
  const host = qs('[data-home-stats]');
  const stats = await api.get('/stats', { signal });
  const values = [stats.departments, stats.courses, stats.lessons, stats.learners];
  host.querySelectorAll('.stat__value').forEach((node, index) => {
    node.textContent = formatNumber(values[index] ?? 0);
  });
  setBusy(host, false);
}

async function loadDepartments(signal) {
  const host = qs('[data-home-departments]');
  const departments = await api.get('/departments', { signal });
  if (!departments.length) {
    host.replaceChildren(emptyState({ title: 'No departments yet', message: 'The catalogue is being set up.' }));
    return;
  }
  host.replaceChildren(...departments.slice(0, 6).map(departmentTile));
  setBusy(host, false);
}

async function loadFeatured(signal) {
  const host = qs('[data-home-featured]');
  const { items } = await api.get('/courses/featured', { query: { limit: 3 }, signal });
  host.replaceChildren(...items.slice(0, 3).map((course) => courseCard(course)));
  setBusy(host, false);
}

async function loadNewest(signal) {
  const host = qs('[data-home-newest]');
  const { items } = await api.get('/courses', { query: { sort: 'newest', per_page: 3 }, signal });
  host.replaceChildren(...items.map((course) => courseCard(course)));
  setBusy(host, false);
}

export async function init({ signal }) {
  const jobs = [
    loadStats(signal),
    loadDepartments(signal),
    loadFeatured(signal),
    loadNewest(signal),
  ];
  const results = await Promise.allSettled(jobs);

  // Show the first failure once, without overwriting the regions that worked.
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) pageError(failed.reason, () => window.location.reload());
}
