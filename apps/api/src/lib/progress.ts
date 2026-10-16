/**
 * G WORLD — progress and completion rules.
 *
 * All of these functions are pure: no database, no clock unless injected. That
 * makes the "what does completed mean" logic unit-testable, and means the API
 * computes learner progress identically for the dashboard, the admin tables and
 * the certificate issuer.
 */

export interface ProgressLesson {
  id: string;
  position: number;
  /** Only published lessons count toward progress. */
  status: 'draft' | 'published' | 'archived';
  completionRule: 'view' | 'mark_complete' | 'quiz_pass';
}

export interface ProgressState {
  lessonId: string;
  status: 'not_started' | 'in_progress' | 'completed';
}

export interface ProgressSummary {
  totalLessons: number;
  completedLessons: number;
  inProgressLessons: number;
  progressPercent: number;
  isComplete: boolean;
  nextLessonId: string | null;
  lastCompletedPosition: number | null;
}

/**
 * Lessons that a learner is expected to finish. Draft and archived lessons are
 * excluded: an author adding a draft lesson must not retroactively un-complete
 * everybody's course (or worse, block certificates).
 */
export function countableLessons(lessons: readonly ProgressLesson[]): ProgressLesson[] {
  return lessons
    .filter((lesson) => lesson.status === 'published')
    .slice()
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function computeProgressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  const percent = Math.floor((completed / total) * 100);
  return Math.max(0, Math.min(100, percent));
}

export function summarizeProgress(
  lessons: readonly ProgressLesson[],
  states: readonly ProgressState[],
): ProgressSummary {
  const countable = countableLessons(lessons);
  const stateByLesson = new Map(states.map((state) => [state.lessonId, state.status]));

  let completed = 0;
  let inProgress = 0;
  let lastCompletedPosition: number | null = null;
  let nextLessonId: string | null = null;

  for (const lesson of countable) {
    const status = stateByLesson.get(lesson.id) ?? 'not_started';
    if (status === 'completed') {
      completed += 1;
      lastCompletedPosition = lesson.position;
    } else {
      if (status === 'in_progress') inProgress += 1;
      if (!nextLessonId) nextLessonId = lesson.id;
    }
  }

  const progressPercent = computeProgressPercent(completed, countable.length);
  return {
    totalLessons: countable.length,
    completedLessons: completed,
    inProgressLessons: inProgress,
    progressPercent,
    isComplete: countable.length > 0 && completed === countable.length,
    nextLessonId,
    lastCompletedPosition,
  };
}

/** Whether an explicit "mark as complete" action is allowed by the lesson rule. */
export function canMarkComplete(rule: ProgressLesson['completionRule']): boolean {
  return rule === 'view' || rule === 'mark_complete';
}

export interface CompletionContext {
  rule: ProgressLesson['completionRule'];
  /** Quiz outcome, required when the lesson rule is `quiz_pass`. */
  quizPassed?: boolean;
  /** Seconds the learner kept the lesson open (anti-instant-click guard). */
  secondsSpent?: number;
}

/** Minimum dwell time before a `view`/`mark_complete` lesson can be completed. */
export const MIN_SECONDS_FOR_COMPLETION = 5;

/**
 * Decides whether a lesson may be marked complete.
 * `quiz_pass` lessons are completed by passing the attached quiz, never by a
 * direct API call — the handler enforces that by only calling this with the
 * server-observed quiz result.
 */
export function satisfiesCompletionRule(context: CompletionContext): boolean {
  switch (context.rule) {
    case 'view':
    case 'mark_complete':
      return (context.secondsSpent ?? 0) >= MIN_SECONDS_FOR_COMPLETION;
    case 'quiz_pass':
      return context.quizPassed === true;
    default:
      return false;
  }
}

/** Ordering helper for the "resume where you left off" dashboard card. */
export function resolveResumeLesson(summary: ProgressSummary): string | null {
  return summary.nextLessonId;
}

/** Course-level completion also requires nothing left in progress. */
export function isCourseComplete(summary: ProgressSummary): boolean {
  return summary.isComplete && summary.inProgressLessons === 0;
}

/**
 * Progress across a whole curriculum (used by the dashboard "learning path"
 * widget and by admin analytics).
 */
export function aggregateCourseProgress(
  courses: readonly { courseId: string; progressPercent: number; status: string }[],
): { active: number; completed: number; averagePercent: number } {
  let active = 0;
  let completed = 0;
  let sum = 0;
  for (const course of courses) {
    if (course.status === 'completed') completed += 1;
    else if (course.status === 'active') active += 1;
    sum += course.progressPercent;
  }
  return {
    active,
    completed,
    averagePercent: courses.length ? Math.round(sum / courses.length) : 0,
  };
}
