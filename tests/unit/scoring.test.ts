/**
 * Quiz and assignment grading.
 *
 * The rules a learner is judged by: no partial credit, short answers compared
 * after normalisation, a pass mark that is clamped, and unattempted questions
 * reported rather than silently scored as zero.
 */
import { describe, expect, it } from 'vitest';
import {
  bestScore,
  gradeAnswer,
  gradeAssignment,
  gradeAttempt,
  hasAttemptsRemaining,
  normalizeShortAnswer,
  type ScoringQuestion,
} from '../../apps/api/src/lib/scoring.js';

const singleChoice: ScoringQuestion = {
  id: 'q_single',
  type: 'single_choice',
  points: 1,
  options: [
    { id: 'o_a', isCorrect: true },
    { id: 'o_b', isCorrect: false },
    { id: 'o_c', isCorrect: false },
  ],
};

const multipleChoice: ScoringQuestion = {
  id: 'q_multi',
  type: 'multiple_choice',
  points: 2,
  options: [
    { id: 'o_a', isCorrect: true },
    { id: 'o_b', isCorrect: true },
    { id: 'o_c', isCorrect: false },
  ],
};

const shortAnswer: ScoringQuestion = {
  id: 'q_short',
  type: 'short_answer',
  points: 1,
  options: [],
  acceptedAnswers: ['box-sizing', 'Box Sizing'],
};

const questions = [singleChoice, multipleChoice, shortAnswer];

describe('grading a single answer', () => {
  it('awards full points for the correct option and nothing otherwise', () => {
    expect(gradeAnswer(singleChoice, { questionId: 'q_single', selectedOptionIds: ['o_a'] })).toMatchObject({
      isCorrect: true,
      pointsAwarded: 1,
    });
    expect(gradeAnswer(singleChoice, { questionId: 'q_single', selectedOptionIds: ['o_b'] })).toMatchObject({
      isCorrect: false,
      pointsAwarded: 0,
    });
  });

  it('gives no partial credit on a multiple-choice question', () => {
    // One of the two correct options: still wrong, and worth zero.
    expect(gradeAnswer(multipleChoice, { questionId: 'q_multi', selectedOptionIds: ['o_a'] })).toMatchObject({
      isCorrect: false,
      pointsAwarded: 0,
    });
    // Both correct options plus a wrong one: also wrong.
    expect(
      gradeAnswer(multipleChoice, { questionId: 'q_multi', selectedOptionIds: ['o_a', 'o_b', 'o_c'] }),
    ).toMatchObject({ isCorrect: false, pointsAwarded: 0 });
    // Exactly the correct set: full marks.
    expect(gradeAnswer(multipleChoice, { questionId: 'q_multi', selectedOptionIds: ['o_b', 'o_a'] })).toMatchObject({
      isCorrect: true,
      pointsAwarded: 2,
    });
  });

  it('ignores option ids that do not belong to the question', () => {
    const result = gradeAnswer(singleChoice, { questionId: 'q_single', selectedOptionIds: ['o_a', 'o_ghost'] });
    expect(result).toMatchObject({ isCorrect: true, pointsAwarded: 1 });
  });

  it('treats a question with no correct option as unanswerable', () => {
    const broken: ScoringQuestion = { id: 'q_broken', type: 'single_choice', points: 1, options: [{ id: 'o_a', isCorrect: false }] };
    expect(gradeAnswer(broken, { questionId: 'q_broken', selectedOptionIds: ['o_a'] })).toMatchObject({
      isCorrect: false,
      pointsAwarded: 0,
    });
  });

  it('accepts an unanswered question without throwing', () => {
    expect(gradeAnswer(singleChoice, undefined)).toMatchObject({ isCorrect: false, pointsAwarded: 0 });
  });

  it('compares short answers case-insensitively and trimmed', () => {
    expect(normalizeShortAnswer('  Box   Sizing ')).toBe('box sizing');
    expect(gradeAnswer(shortAnswer, { questionId: 'q_short', answerText: '  BOX-SIZING ' })).toMatchObject({
      isCorrect: true,
      pointsAwarded: 1,
    });
    expect(gradeAnswer(shortAnswer, { questionId: 'q_short', answerText: 'border-box' })).toMatchObject({
      isCorrect: false,
      pointsAwarded: 0,
    });
    expect(gradeAnswer(shortAnswer, { questionId: 'q_short', answerText: '   ' })).toMatchObject({ isCorrect: false });
  });
});

describe('grading a whole attempt', () => {
  const correct = [
    { questionId: 'q_single', selectedOptionIds: ['o_a'] },
    { questionId: 'q_multi', selectedOptionIds: ['o_a', 'o_b'] },
    { questionId: 'q_short', answerText: 'box-sizing' },
  ];

  it('scores a perfect attempt at 100% and passes it', () => {
    const result = gradeAttempt(questions, correct, { passMarkPercent: 70 });
    expect(result).toMatchObject({ scorePoints: 4, maxPoints: 4, scorePercent: 100, passed: true });
    expect(result.unanswered).toEqual([]);
  });

  it('reports unanswered questions instead of counting them as attempted', () => {
    const result = gradeAttempt(questions, [correct[0]!], { passMarkPercent: 70 });
    expect(result.scorePoints).toBe(1);
    expect(result.unanswered).toEqual(['q_multi', 'q_short']);
    expect(result.answers).toHaveLength(3);
  });

  it('fails an attempt below the pass mark and passes it exactly at the mark', () => {
    const oneOfFour = gradeAttempt(questions, [correct[0]!], { passMarkPercent: 25 });
    expect(oneOfFour.scorePercent).toBe(25);
    expect(oneOfFour.passed).toBe(true);

    const below = gradeAttempt(questions, [correct[0]!], { passMarkPercent: 30 });
    expect(below.passed).toBe(false);
  });

  it('clamps an out-of-range pass mark instead of trusting the column', () => {
    expect(gradeAttempt(questions, [], { passMarkPercent: 0 }).passed).toBe(false); // clamped up to 1
    expect(gradeAttempt(questions, correct, { passMarkPercent: 500 }).passed).toBe(true); // clamped down to 100
  });

  it('gives 0% rather than NaN for a quiz with no questions', () => {
    expect(gradeAttempt([], [], { passMarkPercent: 70 })).toMatchObject({ scorePercent: 0, passed: false, maxPoints: 0 });
  });
});

describe('attempt bookkeeping', () => {
  it('takes the best graded or submitted score, ignoring abandoned attempts', () => {
    expect(
      bestScore([
        { scorePercent: 40, status: 'graded' },
        { scorePercent: 90, status: 'submitted' },
        { scorePercent: 100, status: 'abandoned' },
        { scorePercent: 55, status: 'in_progress' },
      ]),
    ).toBe(90);
  });

  it('reports zero when nothing has been scored', () => {
    expect(bestScore([])).toBe(0);
    expect(bestScore([{ scorePercent: 80, status: 'in_progress' }])).toBe(0);
  });

  it('knows when attempts are exhausted', () => {
    expect(hasAttemptsRemaining(2, 3)).toBe(true);
    expect(hasAttemptsRemaining(3, 3)).toBe(false);
    expect(hasAttemptsRemaining(4, 3)).toBe(false);
  });
});

describe('assignment grading', () => {
  it('rounds to an integer percentage', () => {
    expect(gradeAssignment(85, 100, 80)).toEqual({ scorePercent: 85, passed: true });
    expect(gradeAssignment(79, 100, 80)).toEqual({ scorePercent: 79, passed: false });
    expect(gradeAssignment(2, 3, 60)).toEqual({ scorePercent: 67, passed: true });
  });

  it('cannot pass an assignment worth no points', () => {
    expect(gradeAssignment(0, 0, 60)).toEqual({ scorePercent: 0, passed: false });
  });
});
