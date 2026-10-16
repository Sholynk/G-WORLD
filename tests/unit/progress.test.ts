/**
 * Progress and completion rules.
 *
 * "Completed" is the definition the certificate issuer trusts, so the edges are
 * tested explicitly: draft lessons are invisible, archived lessons stop counting,
 * a two-second visit is not a completion, and a quiz-locked lesson cannot be
 * marked done by clicking a button.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_SECONDS_FOR_COMPLETION,
  canMarkComplete,
  computeProgressPercent,
  countableLessons,
  isCourseComplete,
  resolveResumeLesson,
  satisfiesCompletionRule,
  summarizeProgress,
  type ProgressLesson,
  type ProgressState,
} from '../../apps/api/src/lib/progress.js';

const lesson = (
  id: string,
  position: number,
  status: ProgressLesson['status'] = 'published',
  completionRule: ProgressLesson['completionRule'] = 'mark_complete',
): ProgressLesson => ({ id, position, status, completionRule });

describe('which lessons count', () => {
  it('counts only published lessons, in position order', () => {
    const lessons = [
      lesson('l3', 3),
      lesson('l1', 1),
      lesson('l2', 2, 'draft'),
      lesson('l4', 4, 'archived'),
    ];
    expect(countableLessons(lessons).map((item) => item.id)).toEqual(['l1', 'l3']);
  });

  it('never mutates the array it was given', () => {
    const lessons = [lesson('l2', 2), lesson('l1', 1)];
    countableLessons(lessons);
    expect(lessons.map((item) => item.id)).toEqual(['l2', 'l1']);
  });
});

describe('progress percentage', () => {
  it('rounds down to a whole percent', () => {
    expect(computeProgressPercent(1, 3)).toBe(33);
    expect(computeProgressPercent(2, 3)).toBe(66);
    expect(computeProgressPercent(5, 5)).toBe(100);
  });

  it('never divides by zero and never exceeds 100', () => {
    expect(computeProgressPercent(0, 0)).toBe(0);
    expect(computeProgressPercent(7, 5)).toBe(100);
    expect(computeProgressPercent(-1, 5)).toBe(0);
  });
});

describe('summarising a course', () => {
  const lessons = [lesson('l1', 1), lesson('l2', 2), lesson('l3', 3), lesson('l4', 4, 'draft')];

  it('counts published lessons only and points at the next unfinished one', () => {
    const states: ProgressState[] = [
      { lessonId: 'l1', status: 'completed' },
      { lessonId: 'l2', status: 'in_progress' },
      { lessonId: 'l3', status: 'not_started' },
    ];
    const summary = summarizeProgress(lessons, states);

    expect(summary.totalLessons).toBe(3); // the draft lesson is not part of the course yet
    expect(summary.completedLessons).toBe(1);
    expect(summary.inProgressLessons).toBe(1);
    expect(summary.progressPercent).toBe(33);
    expect(summary.isComplete).toBe(false);
    expect(summary.nextLessonId).toBe('l2');
    expect(summary.lastCompletedPosition).toBe(1);
  });

  it('reports a finished course as complete with no next lesson', () => {
    const states: ProgressState[] = lessons.map((item) => ({ lessonId: item.id, status: 'completed' as const }));
    const summary = summarizeProgress(lessons, states);

    expect(summary.progressPercent).toBe(100);
    expect(summary.isComplete).toBe(true);
    expect(summary.nextLessonId).toBeNull();
    expect(isCourseComplete(summary)).toBe(true);
  });

  it('treats a course with nothing published as empty, not complete', () => {
    const summary = summarizeProgress([lesson('l1', 1, 'draft')], []);
    expect(summary).toMatchObject({ totalLessons: 0, progressPercent: 0, isComplete: false });
  });

  it('ignores progress rows for lessons that no longer count', () => {
    const summary = summarizeProgress(lessons, [
      { lessonId: 'l4', status: 'completed' }, // draft
      { lessonId: 'l1', status: 'completed' },
    ]);
    expect(summary.completedLessons).toBe(1);
  });
});

describe('the completion rule', () => {
  it('requires the minimum dwell time for view and mark_complete lessons', () => {
    expect(satisfiesCompletionRule({ rule: 'mark_complete', secondsSpent: MIN_SECONDS_FOR_COMPLETION })).toBe(true);
    expect(satisfiesCompletionRule({ rule: 'mark_complete', secondsSpent: MIN_SECONDS_FOR_COMPLETION - 1 })).toBe(false);
    expect(satisfiesCompletionRule({ rule: 'view' })).toBe(false); // unknown time = not proven
    expect(satisfiesCompletionRule({ rule: 'view', secondsSpent: 600 })).toBe(true);
  });

  it('will not complete a quiz-gated lesson without a pass', () => {
    expect(satisfiesCompletionRule({ rule: 'quiz_pass', quizPassed: false, secondsSpent: 600 })).toBe(false);
    expect(satisfiesCompletionRule({ rule: 'quiz_pass', quizPassed: true })).toBe(true);
    expect(satisfiesCompletionRule({ rule: 'quiz_pass' })).toBe(false);
  });

  it('only offers the button where clicking it does something', () => {
    expect(canMarkComplete('mark_complete')).toBe(true);
    expect(canMarkComplete('view')).toBe(true);
    expect(canMarkComplete('quiz_pass')).toBe(false);
  });
});

describe('resume where you left off', () => {
  it('prefers the lesson in progress, then the next unfinished one', () => {
    const summary = summarizeProgress(
      [lesson('l1', 1), lesson('l2', 2), lesson('l3', 3)],
      [{ lessonId: 'l1', status: 'completed' }],
    );
    expect(resolveResumeLesson(summary)).toBe(summary.nextLessonId);
    expect(resolveResumeLesson({ ...summary, nextLessonId: null })).toBeNull();
  });
});
