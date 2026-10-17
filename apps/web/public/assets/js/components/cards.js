/**
 * Components — the cards used across the catalogue.
 *
 * One card vocabulary for the whole site, straight from the approved template:
 *
 *   · a card is white, framed by a 1px border, 12px radius, 20px padding;
 *   · an image block is 110px tall, blue tinted, and shows the word "Image"
 *     when the content has no artwork of its own;
 *   · a tag is a pill in blue tint with blue-dark text at 12px;
 *   · a course card carries a skill tag, a title, a description and an
 *     "Enroll" button.
 */
import { el } from '../core/dom.js';
import { formatNumber, humanize } from '../core/format.js';

/** The neutral image block from the template. */
export function imagePlaceholder(label = 'Image') {
  return el('div', {
    class: 'image-placeholder',
    children: [el('span', { text: label })],
  });
}

/**
 * The image block of a card: real artwork when the content has one, the
 * placeholder otherwise. Real images are lazy-loaded.
 */
export function cardMedia(url, alt = '') {
  if (!url) return imagePlaceholder();
  return el('div', {
    class: 'card__media',
    children: [
      el('img', {
        attrs: { src: url, alt, loading: 'lazy', decoding: 'async' },
      }),
    ],
  });
}

/** A blue pill tag. */
export function tag(text) {
  return el('span', { class: 'tag', text });
}

/** The skill (or level) a course teaches, used as the card's tag. */
export function courseTag(course) {
  const skill = course?.skills?.acquired?.[0]?.name ?? course?.skills?.[0]?.name;
  if (skill) return skill;
  if (course?.difficulty) return humanize(course.difficulty);
  return course?.subject?.name ?? 'Course';
}

/**
 * Department card: image, title, a short description and the number of
 * subjects inside the department.
 */
export function departmentCard(department) {
  return el('article', {
    class: 'card card--course',
    children: [
      cardMedia(department.image_url, ''),
      el('h3', {
        class: 'card__title',
        children: [
          el('a', {
            text: department.name,
            attrs: { href: `/departments.html?department=${encodeURIComponent(department.slug)}` },
          }),
        ],
      }),
      el('p', {
        class: 'card__summary',
        text: department.description ?? department.tagline ?? 'Explore the subjects and courses in this department.',
      }),
      el('p', {
        class: 'card__meta',
        text: `${formatNumber(department.subject_count)} subject${department.subject_count === 1 ? '' : 's'}`,
      }),
    ],
  });
}

/** Subject card: image, department tag, title, description and course count. */
export function subjectCard(subject) {
  return el('article', {
    class: 'card card--course',
    children: [
      cardMedia(null, ''),
      tag(subject.department_name ?? 'Subject'),
      el('h3', {
        class: 'card__title',
        children: [
          el('a', {
            text: subject.name,
            attrs: { href: `/subject.html?subject=${encodeURIComponent(subject.slug)}` },
          }),
        ],
      }),
      el('p', {
        class: 'card__summary',
        text: subject.description ?? 'Work through the courses in this subject.',
      }),
      el('p', {
        class: 'card__meta',
        text: `${formatNumber(subject.course_count)} course${subject.course_count === 1 ? '' : 's'}`,
      }),
    ],
  });
}

/**
 * Course card: image, skill tag, title, description and an "Enroll" button.
 *
 * @param {object} course
 * @param {object} [options]
 * @param {string} [options.actionLabel]  label of the primary button
 * @param {string} [options.actionHref]   where the primary button goes
 * @param {(course: object) => void} [options.onEnroll]  when given, the
 *   primary button enrols the learner instead of linking to the course page
 */
export function courseCard(course, options = {}) {
  const actionLabel = options.actionLabel ?? 'Enroll';
  const actionHref = options.actionHref ?? `/course.html?slug=${encodeURIComponent(course.slug)}`;

  const action = options.onEnroll
    ? el('button', {
        class: 'btn',
        text: actionLabel,
        attrs: { type: 'button' },
        on: { click: () => options.onEnroll(course) },
      })
    : el('a', {
        class: 'btn',
        text: actionLabel,
        attrs: { href: actionHref },
      });

  return el('article', {
    class: 'card card--course',
    children: [
      cardMedia(course.thumbnail_url, ''),
      tag(courseTag(course)),
      el('h3', {
        class: 'card__title',
        children: [
          el('a', {
            text: course.title,
            attrs: { href: `/course.html?slug=${encodeURIComponent(course.slug)}` },
          }),
        ],
      }),
      el('p', {
        class: 'card__summary',
        text: course.summary ?? course.description ?? 'A structured course with lessons, quizzes and a certificate.',
      }),
      el('div', {
        class: 'card__footer',
        children: [
          el('div', {
            class: 'btn-row',
            children: [
              action,
              course.subject?.slug
                ? el('a', {
                    class: 'btn o',
                    text: 'Browse subjects',
                    attrs: { href: `/subject.html?subject=${encodeURIComponent(course.subject.slug)}` },
                  })
                : null,
            ],
          }),
        ],
      }),
    ],
  });
}

/** A card in the "How learning flows" row: a title and one line of text. */
export function flowCard({ title, description, href = null }) {
  return el('article', {
    class: 'card',
    children: [
      el('h3', {
        class: 'card__title',
        children: [href ? el('a', { text: title, attrs: { href } }) : title],
      }),
      el('p', { class: 'card__summary', text: description }),
    ],
  });
}

/**
 * Where the learner is inside a course.
 *
 * `detail` is the enrolment payload (`GET /me/enrollments/:id`): its curriculum
 * plus `next_lesson_id` tell us the module and the lesson to show.
 */
export function nextLessonPosition(detail) {
  if (!detail?.curriculum?.length) return null;

  for (const module of detail.curriculum) {
    const lessons = module.lessons ?? [];
    const index = lessons.findIndex((lesson) => lesson.id === detail.next_lesson_id);
    if (index === -1) continue;
    return {
      module: `Module ${module.position} · ${module.title}`,
      lesson: `Lesson ${index + 1} · ${lessons[index].title}`,
      lessonId: detail.next_lesson_id,
    };
  }
  return null;
}

/**
 * Enrolled-course card: the status tag, the module and lesson the learner is
 * on, a progress bar and a "Continue" button. The template shows these cards
 * without an image.
 *
 * @param {object} enrollment
 * @param {object} [detail]  the enrolment detail payload, when it was loaded
 */
export function enrolledCourseCard(enrollment, detail = null) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(enrollment.progress_percent ?? 0))));
  const done = Number(enrollment.lessons_completed ?? 0);
  const total = Number(enrollment.total_lessons ?? 0);
  const position = nextLessonPosition(detail);
  const course = enrollment.course ?? {};

  const continueHref = position?.lessonId
    ? `/lesson.html?id=${encodeURIComponent(position.lessonId)}&course=${encodeURIComponent(course.slug ?? '')}`
    : `/course.html?slug=${encodeURIComponent(course.slug ?? '')}`;

  return el('article', {
    class: 'card card--course',
    children: [
      tag(enrollment.status === 'completed' ? 'Completed' : 'In progress'),
      el('h3', {
        class: 'card__title',
        children: [
          el('a', {
            text: course.title ?? 'Course',
            attrs: { href: `/course.html?slug=${encodeURIComponent(course.slug ?? '')}` },
          }),
        ],
      }),
      position
        ? el('p', { class: 'card__summary', text: position.module })
        : el('p', { class: 'card__summary', text: course.subject_name ?? 'Course' }),
      position ? el('p', { class: 'card__summary', text: position.lesson }) : null,
      el('span', {
        class: 'progress',
        attrs: {
          role: 'progressbar',
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuenow': String(percent),
          'aria-label': `${course.title ?? 'Course'} progress`,
        },
        children: [
          el('span', {
            class: 'progress__bar',
            attrs: { style: `--progress-value: ${percent}%` },
          }),
        ],
      }),
      el('p', { class: 'card__meta', text: `${formatNumber(done)} of ${formatNumber(total)} lessons` }),
      el('div', {
        class: 'card__footer',
        children: [
          el('a', {
            class: 'btn',
            text: enrollment.status === 'completed' ? 'Review course' : 'Continue',
            attrs: { href: continueHref },
          }),
        ],
      }),
    ],
  });
}
