/**
 * Page — course detail.
 *
 * Reads the catalogue view of one course (`GET /courses/:slug`), renders the
 * curriculum, and offers enrolment. Enrolment state comes from `/me/enrollments`
 * for a signed-in visitor; an anonymous visitor gets "Sign in to enrol", which
 * is honest — the API rejects unverified accounts anyway.
 */
import { api } from '../core/api.js';
import { el, queryParam, qs } from '../core/dom.js';
import { formatDuration, formatNumber, formatPercent } from '../core/format.js';
import { difficultyLabel } from '../components/course-card.js';
import { emptyState } from '../components/empty-state.js';
import { statusBadge } from '../components/progress.js';
import { toastError, toastSuccess } from '../components/toast.js';
import { fill, pageError, setBusy, toggle } from './_shared.js';

function lessonRow(lesson, courseSlug) {
  const state = lesson.progress ?? null;
  const done = state === 'completed';
  const locked = lesson.unlocked === false && !lesson.is_preview;

  const inner = [
    el('span', {
      class: 'curriculum__lesson-status',
      text: done ? '✓' : locked ? '🔒' : lesson.is_preview ? '👁' : '○',
      attrs: { 'aria-hidden': 'true' },
    }),
    el('span', { class: 'full-width', text: lesson.title }),
    el('span', { class: 'subtle', text: formatDuration(lesson.estimated_minutes) }),
    lesson.is_preview ? el('span', { class: 'badge badge--accent', text: 'Preview' }) : null,
  ];

  const className = `curriculum__lesson${done ? ' curriculum__lesson--done' : ''}${locked ? ' curriculum__lesson--locked' : ''}`;

  if (locked) {
    return el('li', { children: [el('span', { class: className, children: inner })] });
  }

  return el('li', {
    children: [
      el('a', {
        class: className,
        attrs: { href: `/lesson.html?id=${encodeURIComponent(lesson.id)}&course=${encodeURIComponent(courseSlug)}` },
        children: inner,
      }),
    ],
  });
}

function moduleBlock(module, courseSlug, openFirst) {
  return el('li', {
    class: 'curriculum__module',
    children: [
      el('details', {
        attrs: { ...(openFirst ? { open: '' } : {}) },
        children: [
          el('summary', {
            class: 'curriculum__summary',
            children: [
              el('span', { text: module.title }),
              el('span', {
                class: 'subtle',
                text: `${formatNumber(module.lesson_count)} lessons · ${formatDuration(module.estimated_minutes)}`,
              }),
            ],
          }),
          el('ul', {
            class: 'list-plain',
            children: (module.lessons ?? []).map((lesson) => lessonRow(lesson, courseSlug)),
          }),
        ],
      }),
    ],
  });
}

export async function init({ signal, session }) {
  const slug = queryParam('slug') ?? queryParam('course');
  if (!slug) {
    pageError({ message: 'No course was named in the address. Pick one from the catalogue.' });
    return;
  }

  try {
    const [detail, enrollments] = await Promise.all([
      api.get(`/courses/${encodeURIComponent(slug)}`, { signal }),
      session ? api.get('/me/enrollments', { signal }).catch(() => []) : Promise.resolve([]),
    ]);

    const { course, curriculum, skills, resources } = detail;

    document.title = `${course.title} · G WORLD`;
    fill('[data-course-crumb]', course.title);
    fill('[data-course-difficulty]', difficultyLabel(course.difficulty));
    fill('[data-course-lessons]', formatNumber(
      curriculum.reduce((total, module) => total + (module.lessons?.length ?? 0), 0),
    ));
    fill('[data-course-duration]', formatDuration(course.estimated_minutes));
    fill('[data-course-instructor]', course.instructor_name ?? '—');
    fill('[data-course-certificate]', course.certificate_enabled ? 'Yes, on completion' : 'No');

    const header = qs('[data-course-header]');
    header.replaceChildren(
      el('h1', { text: course.title }),
      el('p', { class: 'lede', text: course.summary ?? '' }),
      el('p', {
        class: 'cluster cluster--tight',
        children: [
          course.department_name ? el('span', { class: 'badge', text: course.department_name }) : null,
          course.subject_name ? el('span', { class: 'badge', text: course.subject_name }) : null,
          course.language ? el('span', { class: 'badge', text: course.language.toUpperCase() }) : null,
          course.published_at ? el('span', { class: 'subtle', text: `Published ${new Date(course.published_at).toLocaleDateString()}` }) : null,
        ].filter(Boolean),
      }),
      el('div', { class: 'lesson-body', text: course.description ?? '' }),
    );
    setBusy(header, false);

    // Skills: required (what the course teaches) and acquired (what the learner has).
    const skillsHost = qs('[data-course-outcomes]');
    const acquired = new Set((skills?.acquired ?? []).map((skill) => skill.id ?? skill.name));
    const outcomes = [...(skills?.required ?? []), ...(skills?.acquired ?? [])];
    if (outcomes.length) {
      skillsHost.replaceChildren(
        ...outcomes.map((skill) =>
          el('li', {
            text: acquired.has(skill.id) ? `${skill.name} ✓` : skill.name,
          }),
        ),
      );
    } else {
      skillsHost.replaceChildren(
        ...(course.outcomes ?? ['Work through the modules in order', 'Complete every lesson', 'Pass the assessments'])
          .map((line) => el('li', { text: line })),
      );
    }

    // Curriculum
    const curriculumHost = qs('[data-course-curriculum]');
    curriculumHost.replaceChildren(...curriculum.map((module, index) => moduleBlock(module, course.slug, index === 0)));
    setBusy(curriculumHost, false);
    fill(
      '[data-curriculum-summary]',
      `${formatNumber(curriculum.length)} modules · ${formatNumber(
        curriculum.reduce((total, module) => total + (module.lessons?.length ?? 0), 0),
      )} lessons`,
    );

    // Resources column (empty for most seeded courses, so the region stays quiet).
    const resourcesHost = qs('[data-course-resources]');
    if (resourcesHost) {
      resourcesHost.replaceChildren(
        ...(resources?.length
          ? resources.map((resource) =>
              el('li', {
                children: [
                  el('a', { text: resource.title, attrs: { href: resource.url ?? resource.file_url ?? '#' } }),
                ],
              }),
            )
          : [el('li', { class: 'muted', text: 'No downloadable resources for this course.' })]),
      );
    }

    const previewLesson = curriculum
      .flatMap((module) => module.lessons ?? [])
      .find((lesson) => lesson.is_preview);

    if (previewLesson) {
      const card = qs('[data-course-preview-card]');
      const link = qs('[data-preview-link]');
      card.hidden = false;
      link.setAttribute('href', `/lesson.html?id=${encodeURIComponent(previewLesson.id)}&course=${encodeURIComponent(course.slug)}`);
    }

    // ------------------------------------------------------------- enrolment
    const enrolment = enrollments.find((row) => row.course?.id === course.id || row.course_id === course.id);
    const enrolButton = qs('[data-enrol]');
    const enrolStatus = qs('[data-enrol-status]');

    if (enrolment) {
      enrolButton.textContent = 'Continue learning';
      enrolButton.addEventListener('click', () => {
        window.location.assign(`/lesson.html?id=${encodeURIComponent(enrolment.last_lesson_id ?? previewLesson?.id ?? '')}&course=${encodeURIComponent(course.slug)}`);
      });
      enrolStatus.replaceChildren(
        statusBadge(enrolment.status),
        el('span', { text: ` ${formatPercent(enrolment.progress_percent)} complete · ${formatNumber(enrolment.lessons_completed)} of ${formatNumber(enrolment.total_lessons)} lessons` }),
      );
    } else if (!course.enrollment_open) {
      enrolButton.disabled = true;
      enrolButton.textContent = 'Enrolment closed';
      enrolStatus.textContent = 'This course is not accepting new learners right now.';
    } else if (!session) {
      enrolButton.textContent = 'Sign in to enrol';
      enrolButton.addEventListener('click', () => {
        window.location.assign(`/login.html?next=${encodeURIComponent(`/course.html?slug=${course.slug}`)}`);
      });
    } else {
      enrolButton.addEventListener('click', async () => {
        enrolButton.disabled = true;
        enrolStatus.textContent = 'Enrolling…';
        try {
          await api.post('/enrollments', { course_id: course.id });
          toastSuccess(`You are enrolled in ${course.title}.`, 'Welcome aboard');
          window.location.reload();
        } catch (error) {
          enrolButton.disabled = false;
          enrolStatus.textContent = '';
          toastError(error.message);
        }
      });
    }
  } catch (error) {
    pageError(error, () => window.location.reload());
  }
}
