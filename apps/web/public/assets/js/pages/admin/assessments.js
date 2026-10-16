/**
 * Admin page — assessments.
 *
 * Quizzes are listed with their question counts; opening one shows its questions
 * *with* the correct options marked, which is precisely what a learner's request
 * never receives. Submissions below can be graded with points and feedback.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { formatDateTime, formatNumber, formatPercent, humanize } from '../../core/format.js';
import { statusBadge } from '../../components/progress.js';
import { renderTable } from '../../components/table.js';
import { toastError, toastSuccess } from '../../components/toast.js';
import { openModal } from '../../components/modal.js';
import { pageError } from '../_shared.js';
import { requireStaff } from './_shared.js';

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const quizHost = qs('[data-quiz-table]');
  const quizCount = qs('[data-quiz-count]');
  const detailHost = qs('[data-quiz-detail]');
  const submissionHost = qs('[data-submission-table]');
  const statusSelect = qs('[data-submission-status]');

  async function openQuiz(quiz) {
    try {
      const detail = await api.get(`/admin/quizzes/${encodeURIComponent(quiz.id)}`, { signal });
      detailHost.hidden = false;
      qs('[data-quiz-detail-title]').textContent = `${detail.quiz?.title ?? quiz.title} — ${formatNumber(detail.questions?.length ?? 0)} questions`;

      qs('[data-quiz-questions]').replaceChildren(
        ...(detail.questions ?? []).map((question, index) =>
          el('fieldset', {
            class: 'fieldset',
            children: [
              el('legend', { text: `${index + 1}. ${question.prompt}` }),
              el('p', {
                class: 'subtle',
                text: `${humanize(question.type)} · ${formatNumber(question.points)} points${
                  detail.stats?.attempts ? ` · ${formatNumber(detail.stats.attempts)} attempts` : ''
                }`,
              }),
              el('ul', {
                class: 'list-plain stack-sm',
                children: (question.options ?? []).map((option) =>
                  el('li', {
                    class: `choice${option.is_correct ? ' choice--correct' : ''}`,
                    children: [
                      el('span', { text: option.is_correct ? '✓ ' : ' ' }),
                      el('span', { text: option.label }),
                    ],
                  }),
                ),
              }),
              question.explanation ? el('p', { class: 'subtle', text: `Explanation: ${question.explanation}` }) : null,
            ].filter(Boolean),
          }),
        ),
      );
      detailHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      toastError(error.message);
    }
  }

  async function loadQuizzes() {
    quizHost.setAttribute('aria-busy', 'true');
    // This endpoint returns a bare array, not the usual `{items}` envelope.
    const quizzes = await api.get('/admin/quizzes', { signal });
    quizCount.textContent = `${formatNumber(quizzes.length)} quizzes`;

    renderTable(quizHost, {
      caption: 'Quizzes',
      columns: [
        { key: 'title', label: 'Quiz' },
        { key: 'lesson_id', label: 'Attached to', render: (row) => el('span', { class: 'mono', text: row.lesson_id ?? row.module_id ?? row.course_id }) },
        { key: 'question_count', label: 'Questions', numeric: true, render: (row) => formatNumber(row.question_count) },
        { key: 'pass_mark_percent', label: 'Pass mark', numeric: true, render: (row) => formatPercent(row.pass_mark_percent) },
        { key: 'max_attempts', label: 'Attempts', numeric: true, render: (row) => row.max_attempts ?? '∞' },
        { key: 'show_answers', label: 'Reveals answers', render: (row) => humanize(row.show_answers) },
        { key: 'status', label: 'Status', render: (row) => statusBadge(row.status) },
      ],
      rows: quizzes,
      emptyMessage: 'No quizzes yet.',
      actions: (row) => [{ label: 'Open', onClick: () => openQuiz(row) }],
    });
  }

  async function loadSubmissions() {
    submissionHost.setAttribute('aria-busy', 'true');
    const query = { per_page: 25 };
    if (statusSelect.value) query.status = statusSelect.value;
    const data = await api.get('/admin/submissions', { query, signal });

    renderTable(submissionHost, {
      caption: 'Student submissions',
      columns: [
        {
          key: 'student',
          label: 'Student',
          render: (row) => el('div', {
            class: 'stack-sm',
            children: [
              el('span', { text: row.student?.name ?? row.student?.email ?? '—' }),
              el('span', { class: 'subtle mono', text: row.student?.student_number ?? '' }),
            ],
          }),
        },
        { key: 'assignment_title', label: 'Assignment' },
        { key: 'attempt_number', label: 'Attempt', numeric: true },
        {
          key: 'submitted_at',
          label: 'Submitted',
          render: (row) => el('span', { text: formatDateTime(row.submitted_at), }),
        },
        {
          key: 'status',
          label: 'Status',
          render: (row) => statusBadge(row.status === 'graded' ? 'completed' : row.status),
        },
        {
          key: 'score_points',
          label: 'Score',
          numeric: true,
          render: (row) => (row.score_points === null || row.score_points === undefined ? '—' : `${row.score_points} / ${row.max_points}`),
        },
      ],
      rows: data.items ?? [],
      emptyMessage: 'No submissions match that status.',
      actions: (row) => [
        {
          label: 'View',
          tone: 'ghost',
          onClick: () =>
            openModal({
              title: row.assignment_title,
              confirmLabel: 'Close',
              body: el('div', {
                class: 'stack-sm',
                children: [
                  el('p', { text: row.submission_text ?? 'No written answer — the learner submitted a file or link.' }),
                  row.link_url ? el('p', { children: [el('a', { text: row.link_url, attrs: { href: row.link_url, target: '_blank', rel: 'noopener' } })] }) : null,
                  row.feedback ? el('p', { class: 'alert alert--info', text: `Feedback: ${row.feedback}` }) : null,
                ].filter(Boolean),
              }),
              onConfirm: async () => {},
            }),
        },
        {
          label: row.status === 'graded' ? 'Re-grade' : 'Grade',
          tone: 'primary',
          onClick: () => openGradeForm(row),
        },
      ],
    });
  }

  function openGradeForm(row) {
    let scoreInput;
    let feedbackInput;

    const body = el('div', {
      class: 'stack-sm',
      children: [
        el('p', { class: 'subtle', text: `Out of ${formatNumber(row.max_points)} points. Score and feedback are saved on the submission.` }),
        el('label', {
          class: 'field',
          children: [
            el('span', { class: 'field__label', text: 'Score' }),
            (scoreInput = el('input', {
              attrs: { type: 'number', min: '0', max: String(row.max_points), value: String(row.score_points ?? 0) },
            })),
          ],
        }),
        el('label', {
          class: 'field',
          children: [
            el('span', { class: 'field__label', text: 'Feedback' }),
            (feedbackInput = el('textarea', { attrs: { rows: '3', maxlength: '5000', value: row.feedback ?? '' } })),
          ],
        }),
      ],
    });

    openModal({
      title: 'Grade submission',
      body,
      confirmLabel: 'Save grade',
      onConfirm: async () => {
        try {
          await api.post('/admin/submissions/grade', {
            submission_id: row.id,
            score_points: Number(scoreInput.value),
            feedback: feedbackInput.value || undefined,
          });
          toastSuccess('Grade saved — the learner is notified.');
          await loadSubmissions();
        } catch (error) {
          toastError(error.message);
          throw error; // keep the dialog open so the grade can be corrected
        }
      },
    });
  }

  statusSelect.addEventListener('change', () => {
    loadSubmissions().catch((error) => pageError(error, () => loadSubmissions()));
  });

  try {
    await Promise.all([loadQuizzes(), loadSubmissions()]);
  } catch (error) {
    pageError(error, () => window.location.reload());
  }
}
