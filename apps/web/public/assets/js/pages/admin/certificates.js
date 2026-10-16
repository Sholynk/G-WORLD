/**
 * Admin page — certificates.
 *
 * Issuing is idempotent per learner and course: if a certificate already exists
 * the API returns it instead of creating a duplicate. Revoking requires a reason
 * and is permanent — the public verification page reports it as revoked.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { formatDate, formatRelative, humanize } from '../../core/format.js';
import { confirmAction } from '../../components/modal.js';
import { renderTable } from '../../components/table.js';
import { renderPagination } from '../../components/pagination.js';
import { toastError, toastSuccess } from '../../components/toast.js';
import { wireForm } from '../../components/form.js';
import { pageError } from '../_shared.js';
import { describePage, requireStaff } from './_shared.js';

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const tableHost = qs('[data-certificate-table]');
  const paginationHost = qs('[data-pagination]');
  let page = 1;

  async function load() {
    tableHost.setAttribute('aria-busy', 'true');
    const data = await api.get('/admin/certificates', { query: { page, per_page: 25 }, signal });

    renderTable(tableHost, {
      caption: 'Issued certificates',
      columns: [
        {
          key: 'holder',
          label: 'Holder',
          render: (row) => el('div', {
            class: 'stack-sm',
            children: [
              el('span', { text: row.holder?.name ?? '—' }),
              el('span', { class: 'subtle mono', text: row.holder?.student_number ?? '' }),
            ],
          }),
        },
        { key: 'course', label: 'Course', render: (row) => row.course?.title ?? row.title ?? '—' },
        { key: 'certificate_number', label: 'Number', render: (row) => el('span', { class: 'mono', text: row.certificate_number }) },
        { key: 'grade', label: 'Grade', render: (row) => humanize(row.grade) },
        { key: 'issued_at', label: 'Issued', render: (row) => formatDate(row.issued_at) },
        {
          key: 'valid',
          label: 'Status',
          render: (row) =>
            el('span', {
              class: `badge ${row.valid ? 'badge--success' : 'badge--danger'}`,
              text: row.valid ? 'Valid' : `Revoked${row.revoked_at ? ` ${formatRelative(row.revoked_at)}` : ''}`,
            }),
        },
        {
          key: 'verification_code',
          label: 'Code',
          render: (row) =>
            el('a', {
              class: 'mono',
              text: row.verification_code,
              attrs: { href: `/verify.html?code=${encodeURIComponent(row.verification_code)}` },
            }),
        },
      ],
      rows: data.items ?? [],
      emptyMessage: 'No certificates have been issued yet.',
      actions: (row) => [
        {
          label: 'Revoke',
          tone: 'danger',
          disabled: !row.valid,
          onClick: async () => {
            const reason = window.prompt(`Why is ${row.certificate_number} being revoked?`);
            if (!reason || reason.trim().length < 3) return;
            const confirmed = await confirmAction({
              title: 'Revoke this certificate?',
              body: 'Verification will report it as revoked from now on. The record is kept, never deleted.',
              confirmLabel: 'Revoke certificate',
              tone: 'danger',
              onConfirm: async () => {
                await api.post('/admin/certificates/revoke', { certificate_id: row.id, reason: reason.trim() });
              },
            });
            if (!confirmed) return;
            toastSuccess('Certificate revoked.');
            await load().catch((error) => toastError(error.message));
          },
        },
      ],
    });

    renderPagination(paginationHost, {
      page: data.pagination.page,
      perPage: data.pagination.per_page,
      total: data.pagination.total,
      itemNoun: 'certificate',
      onPage: (next) => {
        page = next;
        load().catch((error) => pageError(error, () => load()));
      },
    });
  }

  wireForm(qs('[data-issue-form]'), async (values, { setStatus }) => {
    const payload = { user_id: values.user_id, course_id: values.course_id };
    if (values.grade) payload.grade = values.grade;
    setStatus('Issuing…');
    const result = await api.post('/admin/certificates', payload, { signal });
    setStatus(
      result?.already_existed || result?.existed
        ? 'That learner already had a certificate for this course — the existing one was returned.'
        : `Issued ${result?.certificate_number ?? 'the certificate'}.`,
      'success',
    );
    toastSuccess('Certificate request completed.');
    await load().catch((error) => toastError(error.message));
  });

  try {
    await load();
  } catch (error) {
    pageError(error, () => load());
  }
}
