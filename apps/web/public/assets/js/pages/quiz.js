/**
 * Page — quiz.
 *
 * Nothing about correctness is decided here. `POST /quizzes/:id/attempts` hands
 * back the questions with their options but *without* the answer key — the
 * browser is not trusted with it — and submitting sends the learner's choices to
 * the server, which grades them and decides whether to reveal the answers.
 */
import { api } from '../core/api.js';
import { el, qs, queryParam } from '../core/dom.js';
import { formatDuration, formatNumber, formatPercent } from '../core/format.js';
import { emptyState } from '../components/empty-state.js';
import { toastError, toastSuccess } from '../components/toast.js';
import { fill, pageError, toggle } from './_shared.js';

/** Renders one question with the control its type needs. */
function questionBlock(question, index) {
  const multiple = question.type === 'multiple_choice';
  const shortAnswer = question.type === 'short_answer';
  const inputName = `q_${question.id}`;

  const options = (question.options ?? []).map((option) =>
    el('label', {
      class: 'choice',
      children: [
        el('input', {
          attrs: {
            type: multiple ? 'checkbox' : 'radio',
            name: inputName,
            value: option.id,
            ...(multiple ? {} : { required: '' }),
          },
        }),
        el('span', { text: option.label }),
      ],
    }),
  );

  const controls = shortAnswer
    ? el('textarea', { attrs: { name: inputName, rows: '3', maxlength: '2000', 'aria-label': question.prompt } })
    : el('div', { class: 'choice-group', attrs: { role: multiple ? 'group' : 'radiogroup', 'aria-label': question.prompt }, children: options });

  return el('fieldset', {
    class: 'fieldset',
    attrs: { id: `question-${question.id}` },
    children: [
      el('legend', { text: `${index + 1}. ${question.prompt}` }),
      el('p', {
        class: 'subtle',
        text: `${formatNumber(question.points)} ${question.points === 1 ? 'point' : 'points'} · ${
          multiple ? 'Select every correct answer' : shortAnswer ? 'Type your answer' : 'Choose one answer'
        }`,
      }),
      controls,
    ],
  });
}

/** Reads the form back into the API's answer shape. */
function collectAnswers(form, questions) {
  const answers = [];
  for (const question of questions) {
    const name = `q_${question.id}`;
    if (question.type === 'short_answer') {
      const field = form.elements[name];
      const text = typeof field?.value === 'string' ? field.value.trim() : '';
      answers.push({ question_id: question.id, answer_text: text, selected_option_ids: [] });
      continue;
    }
    const nodes = form.querySelectorAll(`[name="${CSS.escape(name)}"]:checked`);
    answers.push({
      question_id: question.id,
      selected_option_ids: [...nodes].map((node) => node.value),
    });
  }
  return answers;
}

export async function init({ signal }) {
  const quizId = queryParam('id') ?? queryParam('quiz');
  if (!quizId) {
    pageError({ message: 'No quiz was named in the address.' });
    return;
  }

  const startButton = qs('[data-start-attempt]');
  const form = qs('[data-quiz-form]');
  const questionsHost = qs('[data-quiz-questions]');
  const status = qs('[data-quiz-status]');
  const submitStatus = qs('[data-submit-status]');
  const resultSection = qs('[data-quiz-result]');

  let attempt = null;
  let questionList = [];
  let startedAt = 0;

  try {
    const detail = await api.get(`/quizzes/${encodeURIComponent(quizId)}`, { signal });
    const { quiz, attempts } = detail;
    questionList = detail.questions ?? [];

    document.title = `${quiz.title} · G WORLD`;
    fill('[data-quiz-title]', quiz.title);
    fill('[data-quiz-meta]', quiz.description ?? 'Answer every question, then submit.');
    fill('[data-quiz-question-count]', formatNumber(questionList.length));
    fill('[data-quiz-pass-mark]', formatPercent(quiz.pass_mark_percent));
    fill(
      '[data-quiz-attempts]',
      quiz.max_attempts ? `${formatNumber(quiz.attempts_used)} of ${formatNumber(quiz.max_attempts)} used` : 'Unlimited',
    );
    fill('[data-quiz-time-limit]', quiz.time_limit_minutes ? formatDuration(quiz.time_limit_minutes) : 'None');

    if (quiz.time_limit_minutes) {
      // Advise, do not enforce: the server owns the clock (and the deadline).
      qs('[data-timer]').hidden = false;
      qs('[data-timer]').textContent = `Suggested time: ${formatDuration(quiz.time_limit_minutes)}. The server records your real time.`;
    }

    if (quiz.attempts_remaining !== undefined && quiz.attempts_remaining <= 0) {
      startButton.disabled = true;
      status.textContent = 'You have used every attempt for this quiz. Your best score stands.';
    } else if (quiz.passed) {
      status.textContent = `Already passed with ${formatPercent(quiz.best_score)}. You can still retake it if attempts remain.`;
    }

    // Most recent attempts, so a learner can see where they stand.
    if (attempts?.length) {
      const history = el('table', {
        class: 'table table--compact',
        children: [
          el('caption', { text: 'Your attempts' }),
          el('thead', {
            children: [
              el('tr', {
                children: ['#', 'Score', 'Result', 'Submitted'].map((label) =>
                  el('th', { text: label, attrs: { scope: 'col' } }),
                ),
              }),
            ],
          }),
          el('tbody', {
            children: attempts.map((row) =>
              el('tr', {
                children: [
                  el('td', { attrs: { 'data-label': '#' }, text: formatNumber(row.attempt_number) }),
                  el('td', { attrs: { 'data-label': 'Score' }, text: formatPercent(row.score_percent) }),
                  el('td', {
                    attrs: { 'data-label': 'Result' },
                    children: [el('span', { class: `badge ${row.passed ? 'badge--success' : 'badge'}` , text: row.passed ? 'Passed' : row.status === 'in_progress' ? 'In progress' : 'Not passed' })],
                  }),
                  el('td', {
                    attrs: { 'data-label': 'Submitted' },
                    text: row.submitted_at ? new Date(row.submitted_at).toLocaleString() : '—',
                  }),
                ],
              }),
            ),
          }),
        ],
      });
      qs('[data-quiz-intro]').append(el('div', { class: 'table-wrap' }, [history]));
    }
  } catch (error) {
    // A quiz belongs to a course, so the API requires a session: say so plainly
    // and offer the way in, instead of showing a red "something went wrong".
    if (error?.code === 'FORBIDDEN' || error?.status === 403) {
      // Signed in, but not enrolled in the course this quiz belongs to. The API
      // is explicit about it; say the same thing and offer the way forward.
      qs('[data-quiz-intro]').replaceChildren(
        emptyState({
          icon: '🔒',
          title: 'Enrol to take this quiz',
          message: error.message ?? 'Quizzes belong to a course. Enrol first, then come back.',
          action: { label: 'Browse courses', href: '/courses.html' },
        }),
      );
      fill('[data-quiz-title]', 'Quiz');
      return;
    }
    if (error?.isAuthError || error?.status === 401) {
      qs('[data-quiz-intro]').replaceChildren(
        emptyState({
          icon: '🔐',
          title: 'Sign in to take this quiz',
          message: 'Quizzes are attached to a course and marked against your account, so we need to know who you are first.',
          action: {
            label: 'Sign in',
            href: `/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
          },
        }),
      );
      fill('[data-quiz-title]', 'Quiz');
      return;
    }
    pageError(error, () => window.location.reload());
    return;
  }

  startButton.addEventListener('click', async () => {
    startButton.disabled = true;
    status.textContent = 'Starting…';
    try {
      // 201 Created: the attempt now exists server-side and is the object we
      // submit answers against.
      const data = await api.post(`/quizzes/${encodeURIComponent(quizId)}/attempts`, {});
      attempt = data.attempt;
      questionList = data.questions ?? questionList;
      startedAt = Date.now();

      questionsHost.replaceChildren(...questionList.map((question, index) => questionBlock(question, index)));
      form.hidden = false;
      startButton.hidden = true;
      status.textContent = `Attempt ${attempt.attempt_number} started.`;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      startButton.disabled = false;
      status.textContent = '';
      toastError(error.message);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!attempt) return;

    const answers = collectAnswers(form, questionList);
    const answered = answers.filter((answer) => answer.selected_option_ids.length > 0 || answer.answer_text).length;
    if (answered < questionList.length) {
      submitStatus.textContent = `${questionList.length - answered} question(s) left blank — they will score zero.`;
    }

    const submitButton = qs('[data-submit-attempt]');
    submitButton.disabled = true;
    submitStatus.textContent = 'Submitting…';

    try {
      const result = await api.post(`/attempts/${encodeURIComponent(attempt.id)}/submit`, {
        answers,
        time_spent_seconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
      });

      form.hidden = true;
      resultSection.hidden = false;

      fill('[data-result-score]', `${formatPercent(result.score?.percent ?? 0)} (${result.score?.points ?? 0} of ${result.score?.max_points ?? 0} points)`);
      const verdict = qs('[data-result-verdict]');
      verdict.className = `badge ${result.score?.passed ? 'badge--success' : 'badge--danger'}`;
      verdict.textContent = result.score?.passed
        ? `Passed — pass mark ${formatPercent(result.score.pass_mark_percent)}`
        : `Not passed — pass mark ${formatPercent(result.score?.pass_mark_percent ?? 0)}`;

      const answersHost = qs('[data-result-answers]');
      if (result.answers?.length) {
        answersHost.replaceChildren(
          el('h3', { class: 'card__title', text: 'Answer review' }),
          ...result.answers.map((answer) =>
            el('div', {
              class: `alert ${answer.is_correct ? 'alert--success' : 'alert--danger'}`,
              children: [
                el('div', {
                  class: 'stack-sm',
                  children: [
                    el('p', { class: 'mb-0', text: answer.prompt }),
                    el('p', {
                      class: 'subtle mb-0',
                      text: `${answer.is_correct ? 'Correct' : 'Incorrect'} · ${formatNumber(answer.points_awarded)} points${
                        answer.explanation ? ` · ${answer.explanation}` : ''
                      }`,
                    }),
                  ],
                }),
              ],
            }),
          ),
        );
      } else {
        answersHost.replaceChildren(
          el('p', {
            class: 'muted',
            text: 'Answer review is hidden for this quiz — only the score is shown.',
          }),
        );
      }

      // The submit response's progress block reports the recalculated course
      // state; when that completion issued a certificate, point at it.
      const nextButton = qs('[data-result-next]');
      if (result.progress?.certificate?.id) {
        nextButton.hidden = false;
        nextButton.textContent = 'View your certificate';
        nextButton.setAttribute('href', `/certificate.html?id=${encodeURIComponent(result.progress.certificate.id)}`);
      } else if (result.progress?.progress_percent !== undefined) {
        nextButton.hidden = false;
        nextButton.textContent = 'Course outline';
        nextButton.setAttribute('href', '/my-courses.html');
      }

      toastSuccess(
        result.score?.passed ? 'Passed. Well done.' : 'Submitted. Review the answers and try again.',
        'Quiz submitted',
      );
    } catch (error) {
      submitButton.disabled = false;
      submitStatus.textContent = '';
      toastError(error.message);
    }
  });
}
