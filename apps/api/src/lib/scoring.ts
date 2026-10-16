/**
 * G WORLD — assessment scoring.
 *
 * Grading is a pure function of the stored questions and the submitted answers.
 * The API never accepts a score from the client, never trusts `is_correct` sent
 * from the browser, and recomputes every attempt server-side. Keeping the rules
 * here (rather than inside a route) means quiz grading is unit-tested directly.
 */

export interface ScoringOption {
  id: string;
  isCorrect: boolean;
}

export interface ScoringQuestion {
  id: string;
  type: 'single_choice' | 'multiple_choice' | 'true_false' | 'short_answer';
  points: number;
  options: readonly ScoringOption[];
  /** Accepted answers for short-answer questions (case/whitespace-insensitive). */
  acceptedAnswers?: readonly string[];
}

export interface SubmittedAnswer {
  questionId: string;
  selectedOptionIds?: readonly string[];
  answerText?: string;
}

export interface GradedAnswer {
  questionId: string;
  isCorrect: boolean;
  pointsAwarded: number;
  /** Ids the learner chose — echoed back only after submission. */
  selectedOptionIds: string[];
}

export interface GradingResult {
  scorePoints: number;
  maxPoints: number;
  scorePercent: number;
  passed: boolean;
  answers: GradedAnswer[];
  /** Question ids with no matching answer row (counted as incorrect). */
  unanswered: string[];
}

const WHITESPACE = /\s+/g;

export function normalizeShortAnswer(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(WHITESPACE, ' ');
}

function gradeChoice(
  question: ScoringQuestion,
  selected: readonly string[],
): { isCorrect: boolean; pointsAwarded: number } {
  const correctIds = question.options.filter((option) => option.isCorrect).map((option) => option.id);
  if (correctIds.length === 0) return { isCorrect: false, pointsAwarded: 0 };

  const uniqueSelected = [...new Set(selected)].filter((id) =>
    question.options.some((option) => option.id === id),
  );

  const allSelectedCorrect = uniqueSelected.every((id) => correctIds.includes(id));
  const allCorrectSelected = correctIds.every((id) => uniqueSelected.includes(id));
  const isCorrect = allSelectedCorrect && allCorrectSelected && uniqueSelected.length === correctIds.length;

  // No partial credit: an answer is right or it is not. This keeps the score
  // explainable to the learner and reproducible in disputes.
  return { isCorrect, pointsAwarded: isCorrect ? question.points : 0 };
}

function gradeShortAnswer(
  question: ScoringQuestion,
  answerText: string | undefined,
): { isCorrect: boolean; pointsAwarded: number } {
  const accepted = question.acceptedAnswers ?? [];
  if (accepted.length === 0) return { isCorrect: false, pointsAwarded: 0 };
  const normalized = normalizeShortAnswer(answerText);
  if (!normalized) return { isCorrect: false, pointsAwarded: 0 };
  const isCorrect = accepted.some((candidate) => normalizeShortAnswer(candidate) === normalized);
  return { isCorrect, pointsAwarded: isCorrect ? question.points : 0 };
}

export function gradeAnswer(question: ScoringQuestion, answer: SubmittedAnswer | undefined): GradedAnswer {
  const selected = [...new Set(answer?.selectedOptionIds ?? [])];

  if (!answer) {
    return { questionId: question.id, isCorrect: false, pointsAwarded: 0, selectedOptionIds: [] };
  }

  if (question.type === 'short_answer') {
    const { isCorrect, pointsAwarded } = gradeShortAnswer(question, answer.answerText);
    return { questionId: question.id, isCorrect, pointsAwarded, selectedOptionIds: [] };
  }

  const { isCorrect, pointsAwarded } = gradeChoice(question, selected);
  return { questionId: question.id, isCorrect, pointsAwarded, selectedOptionIds: selected };
}

export interface GradeOptions {
  /** Percentage required to pass (1–100). */
  passMarkPercent: number;
}

export function gradeAttempt(
  questions: readonly ScoringQuestion[],
  answers: readonly SubmittedAnswer[],
  options: GradeOptions,
): GradingResult {
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const graded: GradedAnswer[] = [];
  const unanswered: string[] = [];

  let scorePoints = 0;
  let maxPoints = 0;

  for (const question of questions) {
    const answer = answerByQuestion.get(question.id);
    const result = gradeAnswer(question, answer);
    graded.push(result);
    scorePoints += result.pointsAwarded;
    maxPoints += question.points;
    if (!answer) unanswered.push(question.id);
  }

  const scorePercent = maxPoints > 0 ? Math.round((scorePoints / maxPoints) * 100) : 0;
  const passMark = Math.max(1, Math.min(100, Math.round(options.passMarkPercent)));

  return {
    scorePoints,
    maxPoints,
    scorePercent,
    passed: scorePercent >= passMark,
    answers: graded,
    unanswered,
  };
}

/** Highest score across attempts — used for dashboards and certificate grades. */
export function bestScore(attempts: readonly { scorePercent: number; status: string }[]): number {
  return attempts
    .filter((attempt) => attempt.status === 'submitted' || attempt.status === 'graded')
    .reduce((best, attempt) => Math.max(best, attempt.scorePercent), 0);
}

export function hasAttemptsRemaining(usedAttempts: number, maxAttempts: number): boolean {
  return usedAttempts < maxAttempts;
}

/** Assignment grading: percentage of the maximum points, then pass/fail. */
export function gradeAssignment(
  scorePoints: number,
  maxPoints: number,
  passMarkPercent: number,
): { scorePercent: number; passed: boolean } {
  if (maxPoints <= 0) return { scorePercent: 0, passed: false };
  const scorePercent = Math.round((scorePoints / maxPoints) * 100);
  return { scorePercent, passed: scorePercent >= passMarkPercent };
}
