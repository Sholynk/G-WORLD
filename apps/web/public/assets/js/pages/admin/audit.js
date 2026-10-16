/**
 * Admin page — audit log.
 *
 * Read-only by design: entries are written by the API when a privileged action
 * happens, and there is no endpoint to edit or delete one. Filters map straight
 * onto the documented query parameters.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { formatDateTime, formatNumber, formatRelative } from '../../core/format.js';
import { renderTable } from '../../components/table.js';
import { renderPagination } from '../../components/pagination.js';
import { pageError } from '../_shared.js';
import { describePage, filterValues, requireStaff } from './_shared.js';

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const form = qs('[data-audit-filters]');
  const summaryHost = qs('[data-audit-summary]');
  const tableHost = qs('[data-audit-table]');
  const paginationHost = qs('[data-pagination]');

  let page = 1;

  async function loadSummary() {
    const summary = await api.get('/admin/audit/summary', { signal });
    summaryHost.replaceChildren(
      ...[
        ['Failed sign-ins (24 h)', summary.failed_logins_24h],
        ['Failed emails', summary.failed_emails],
        ['Events shown below', summary.recent],
      ].map(([label, value]) =>
        el('div', {
          class: 'stat',
          children: [
            el('p', { class: 'stat__value', text: formatNumber(value ?? 0) }),
            el('p', { class: 'stat__label', text: label }),
          ],
        }),
      ),
    );
    summaryHost.setAttribute('aria-busy', 'false');
  }

  async function load() {
    tableHost.setAttribute('aria-busy', 'true');
    const data = await api.get('/admin/audit', {
      query: { ...filterValues(form), page, per_page: 25 },
      signal,
    });

    renderTable(tableHost, {
      caption: describePage(data.pagination, 'entry'),
      columns: [
        { key: 'created_at', label: 'When', render: (row) => el('span', { text: formatRelative(row.created_at), attrs: { title: formatDateTime(row.created_at) } }) },
        { key: 'action', label: 'Action', render: (row) => el('span', { class: 'mono', text: row.action }) },
        { key: 'actor', label: 'Actor', render: (row) => row.actor?.email ?? row.actor?.name ?? 'system' },
        { key: 'entity_type', label: 'Entity', render: (row) => el('span', { class: 'mono', text: `${row.entity_type ?? ''} ${row.entity_id ?? ''}`.trim() }) },
        { key: 'description', label: 'Detail' },
        {
          key: 'status',
          label: 'Status',
          render: (row) => el('span', { class: `badge ${row.status === 'failure' ? 'badge--danger' : 'badge'}`, text: row.status ?? 'ok' }),
        },
        { key: 'request_id', label: 'Request', render: (row) => el('span', { class: 'mono subtle', text: row.request_id ?? '—' }) },
      ],
      rows: data.items ?? [],
      emptyMessage: 'No audit entries match those filters.',
    });

    renderPagination(paginationHost, {
      page: data.pagination.page,
      perPage: data.pagination.per_page,
      total: data.pagination.total,
      itemNoun: 'entry',
      onPage: (next) => {
        page = next;
        load().catch((error) => pageError(error, () => load()));
      },
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    page = 1;
    Promise.all([load(), loadSummary()]).catch((error) => pageError(error, () => load()));
  });

  try {
    await Promise.all([load(), loadSummary()]);
  } catch (error) {
    pageError(error, () => window.location.reload());
  }
}
