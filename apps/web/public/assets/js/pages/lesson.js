/**
 * Page — lesson.
 *
 * The API decides what a visitor may read: a preview lesson is open, an enrolled
 * learner gets the full body, and anything else answers 403. This page renders
 * whatever it is given and never tries to unlock content itself.
 *
 * Opening the page starts a progress record (`POST /lessons/:id/start`), and the
 * "mark complete" button finishes it. `seconds_spent` is measured here but only
 * as a hint — the server clamps it and applies its own minimum.
 */
import { api } from '../core/api.js';
import { ApiError } from '../core/errors.js';
import { el, queryParam, qs } from '../core/dom.js';
import { formatDuration, formatPercent, humanize } from '../core/format.js';
import { emptyState } from '../components/empty-state.js';
import { statusBadge } from '../components/progress.js';
import { toastError, toastSuccess } from '../components/toast.js';
import { videoList, videoPlayer } from '../components/video.js';
import { fill, pageError, setBusy, toggle } from './_shared.js';

const RULE_LABELS = {
  mark_complete: 'Mark it complete when you are done',
  view: 'Completes when you open it',
  quiz_pass: 'Requires passing the lesson quiz',
  watch_video: 'Requires watching the video',
};

export async function init({ signal, session }) {
  const lessonId = queryParam('id') ?? queryParam('lesson');
  if (!lessonId) {
    pageError({ message: 'No lesson was named in the address.' });
    return;
  }

  let view;
  try {
    view = await api.get(`/lessons/${encodeURIComponent(lessonId)}`, { signal });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.code === 'FORBIDDEN')) {
      renderLocked(error);
      return;
    }
    pageError(error, () => window.location.reload());
    return;
  }

  const { lesson, progress, navigation, enrollment, access_level: accessLevel } = view;
  const openedAt = Date.now();

  document.title = `${lesson.title} · G WORLD`;
  fill('[data-lesson-crumb]', lesson.title);
  fill('[data-lesson-module]', lesson.module?.title ?? 'Lesson');
  fill('[data-lesson-title]', lesson.title);
  fill('[data-lesson-duration]', formatDuration(lesson.estimated_minutes));
  fill('[data-lesson-rule]', RULE_LABELS[lesson.completion_rule] ?? humanize(lesson.completion_rule));

  const statusHost = qs('[data-lesson-status]');
  statusHost.replaceChildren(statusBadge(progress?.status ?? 'not_started'));

  const courseLink = qs('[data-lesson-course-link]');
  if (lesson.course?.slug) {
    courseLink.setAttribute('href', `/course.html?slug=${encodeURIComponent(lesson.course.slug)}`);
    courseLink.textContent = lesson.course.title;
  } else {
    courseLink.setAttribute('href', '/courses.html');
    courseLink.textContent = 'Courses';
  }

  // --------------------------------------------------------------- content
  toggle('[data-lesson-content-wrap]', true);

  const videos = lesson.videos ?? [];
  const videoHost = qs('[data-lesson-video]');
  videoHost.replaceChildren(
    videos.length
      ? videoPlayer(videos.find((video) => video.is_primary) ?? videos[0])
      : el('p', { class: 'alert alert--info', text: 'This lesson has no video — the notes below are the whole lesson.' }),
  );

  if (videos.length > 1) {
    qs('[data-lesson-videos]').replaceChildren(
      videoList(videos, {
        onSelect: (video) => videoHost.replaceChildren(videoPlayer(video, { autoload: true })),
      }),
    );
  }

  // `content_html` is produced by the API from the author's Markdown, with the
  // Markdown source HTML-escaped first (apps/api/src/lib/text.ts), so assigning
  // it here cannot execute injected markup.
  const body = qs('[data-lesson-body]');
  if (lesson.content_html) body.innerHTML = lesson.content_html;
  else body.textContent = lesson.content_md ?? 'This lesson has no written notes yet.';

  if (lesson.objectives?.length) {
    toggle('[data-lesson-objectives-wrap]', true);
    qs('[data-lesson-objectives]').replaceChildren(...lesson.objectives.map((objective) => el('li', { text: objective })));
  }

  const resources = lesson.resources ?? [];
  if (resources.length) {
    toggle('[data-lesson-resources-wrap]', true);
    qs('[data-lesson-resources]').replaceChildren(
      ...resources.map((resource) =>
        el('li', {
          children: [
            el('a', { text: resource.title, attrs: { href: resource.url ?? resource.file_url ?? '#' } }),
            resource.description ? el('span', { class: 'subtle', text: ` — ${resource.description}` }) : null,
          ],
        }),
      ),
    );
  }

  // ------------------------------------------------------------ navigation
  const prev = qs('[data-nav-prev]');
  const next = qs('[data-nav-next]');
  const linkFor = (id) => `/lesson.html?id=${encodeURIComponent(id)}&course=${encodeURIComponent(lesson.course?.slug ?? '')}`;

  if (navigation?.previous_lesson_id) {
    prev.hidden = false;
    prev.setAttribute('href', linkFor(navigation.previous_lesson_id));
  }
  if (navigation?.next_lesson_id) {
    next.hidden = false;
    next.setAttribute('href', linkFor(navigation.next_lesson_id));
  }

  // -------------------------------------------------------------- progress
  const percent = enrollment?.progress_percent ?? 0;
  const progressHost = qs('[data-progress]');
  progressHost.setAttribute('aria-valuenow', String(percent));
  qs('[data-progress-bar]').style.setProperty('--progress-value', `${percent}%`);
  fill('[data-progress-percent]', formatPercent(percent));
  fill(
    '[data-progress-detail]',
    enrollment
      ? `${enrollment.lessons_completed} of ${enrollment.total_lessons} lessons complete`
      : 'Progress starts once you enrol.',
  );

  // ------------------------------------------------------------- outline
  if (lesson.course?.slug) {
    api
      .get(`/courses/${encodeURIComponent(lesson.course.slug)}/curriculum`, { signal })
      .then((curriculum) => {
        qs('[data-lesson-outline]').replaceChildren(
          ...curriculum.modules.flatMap((module) => [
            el('li', {
              class: 'stack-sm',
              children: [el('p', { class: 'card__eyebrow', text: module.title })],
            }),
            ...module.lessons.map((item) => {
              const state = item.progress ?? view.progress_map?.[item.id] ?? null;
              const done = (typeof state === 'object' ? state?.status : state) === 'completed';
              const current = item.id === lesson.id;
              return el('li', {
                children: [
                  el('a', {
                    class: `curriculum__lesson${done ? ' curriculum__lesson--done' : ''}`,
                    attrs: {
                      href: linkFor(item.id),
                      ...(current ? { 'aria-current': 'true' } : {}),
                    },
                    children: [
                      el('span', { class: 'curriculum__lesson-status', text: done ? '✓' : current ? '▸' : '○', attrs: { 'aria-hidden': 'true' } }),
                      el('span', { text: item.title }),
                    ],
                  }),
                ],
              });
            }),
          ]),
        );
      })
      .catch(() => {
        // The outline is a convenience; a failure here never blocks the lesson.
      });
  }

  // ---------------------------------------------------------- interactions
  const accessDenied = view.locked === true || accessLevel === 'locked';
  const completeButton = qs('[data-complete-lesson]');
  const completeStatus = qs('[data-complete-status]');
  const alreadyComplete = (progress?.status ?? '') === 'completed';

  if (alreadyComplete) {
    completeButton.disabled = true;
    completeButton.textContent = 'Lesson complete';
  }

  if (!session) {
    completeButton.disabled = true;
    completeStatus.textContent = 'Sign in to save your progress.';
  } else if (accessDenied) {
    completeButton.disabled = true;
    completeStatus.textContent = 'Enrol in this course to track progress.';
  }

  // Record the visit. `start` is idempotent server-side: reopening a lesson does
  // not wipe time already recorded.
  if (session && !accessDenied) {
    api
      .post(`/lessons/${encodeURIComponent(lesson.id)}/start`, {})
      .catch((error) => console.warn('[lesson] start failed', error.message));
  }

  completeButton.addEventListener('click', async () => {
    completeButton.disabled = true;
    completeStatus.textContent = 'Saving…';
    try {
      const seconds = Math.max(0, Math.round((Date.now() - openedAt) / 1000));
      const result = await api.post(`/lessons/${encodeURIComponent(lesson.id)}/complete`, {
        seconds_spent: seconds,
      });
      completeButton.textContent = 'Lesson complete';
      completeStatus.textContent = result?.certificate
        ? 'Lesson complete — your certificate has been issued. 🎉'
        : 'Saved. Nice work.';
      toastSuccess('Lesson marked complete.');
      if (result?.certificate) {
        setTimeout(() => window.location.assign(`/certificate.html?id=${encodeURIComponent(result.certificate.id)}`), 1200);
      }
    } catch (error) {
      completeButton.disabled = false;
      completeStatus.textContent = '';
      toastError(error.message);
    }
  });

  setBusy(qs('[data-progress]'), false);
}

/** Access panel for a lesson the visitor may not read (403 from the API). */
function renderLocked(error) {
  const host = qs('[data-lesson-locked]');
  const courseSlug = queryParam('course');
  host.hidden = false;
  host.replaceChildren(
    emptyState({
      icon: '🔒',
      title: 'This lesson is locked',
      message: error.message ?? 'Enrol in the course to unlock its lessons.',
      action: {
        label: courseSlug ? 'View the course' : 'Browse courses',
        href: courseSlug ? `/course.html?slug=${encodeURIComponent(courseSlug)}` : '/courses.html',
      },
    }),
  );

  // The outline, video and notes stay hidden: there is nothing to show.
  fill('[data-lesson-title]', 'Locked lesson');
  qs('[data-complete-lesson]').disabled = true;
  qs('[data-lesson-nav]').hidden = true;
}
