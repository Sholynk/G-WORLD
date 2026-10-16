/**
 * Components — course card.
 *
 * The card is a single `<article>` with one link covering the title, so keyboard
 * users get one tab stop per course instead of five, and screen readers announce
 * the link with the course title. Metadata is plain text.
 */
import { el } from '../core/dom.js';
import { formatDuration, formatNumber, humanize } from '../core/format.js';

const DIFFICULTY_LABELS = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  expert: 'Expert',
};

export function difficultyLabel(value) {
  return DIFFICULTY_LABELS[value] ?? humanize(value);
}

/**
 * @param {object} course  A course card DTO from `GET /api/v1/courses`.
 * @param {object} [options]
 * @param {boolean} [options.showDepartment]
 */
export function courseCard(course, options = {}) {
  const meta = [];
  if (course.department?.name && options.showDepartment !== false) {
    meta.push(course.department.name);
  }
  meta.push(difficultyLabel(course.difficulty));
  if (course.lesson_count) meta.push(`${formatNumber(course.lesson_count)} lessons`);
  if (course.estimated_minutes) meta.push(formatDuration(course.estimated_minutes));

  return el('article', {
    class: 'card card--course',
    children: [
      el('div', {
        class: 'card__media',
        attrs: { 'aria-hidden': 'true' },
        children: [
          course.thumbnail_url
            ? el('img', { attrs: { src: course.thumbnail_url, alt: '', loading: 'lazy', width: '640', height: '360' } })
            : el('span', { class: 'card__media-glyph', text: course.title.slice(0, 1).toUpperCase() }),
        ],
      }),
      el('div', {
        class: 'card__body stack-sm',
        children: [
          el('p', { class: 'card__eyebrow', text: [course.subject?.name, course.department?.name].filter(Boolean).join(' · ') }),
          el('h3', {
            class: 'card__title',
            children: [
              el('a', {
                text: course.title,
                attrs: { href: `/course.html?slug=${encodeURIComponent(course.slug)}` },
              }),
            ],
          }),
          course.summary ? el('p', { class: 'card__summary', text: course.summary }) : null,
          el('p', { class: 'card__meta', text: meta.filter(Boolean).join(' · ') }),
          course.is_featured
            ? el('p', { class: 'badge badge--accent', text: 'Featured' })
            : null,
        ],
      }),
    ],
  });
}

/** Renders a list of course cards into a container. */
export function renderCourseCards(container, courses, options = {}) {
  container.replaceChildren(...courses.map((course) => courseCard(course, options)));
  return container;
}
