/**
 * Components — data table.
 *
 * Used by the admin screens, where rows really are tabular. Every cell carries a
 * `data-label`, which the stylesheet shows as an inline label once the table
 * re-flows into cards on a narrow screen — so the same markup works on a phone
 * without a second renderer. Actions passed in `actions` are buttons that call
 * back into the page module; the API still authorises every one of them.
 */
import { el } from '../core/dom.js';
import { humanize } from '../core/format.js';
import { emptyState } from './empty-state.js';

/**
 * @param {object} options
 * @param {string} [options.caption]
 * @param {Array<{key: string, label: string, numeric?: boolean, render?: Function, value?: Function}>} options.columns
 * @param {Array<object>} options.rows
 * @param {string} [options.emptyMessage]
 * @param {(row: object) => Array<{label: string, onClick: Function, tone?: string, disabled?: boolean}>} [options.actions]
 * @param {string} [options.rowKey]
 */
export function table({ caption, columns, rows, emptyMessage = 'Nothing to show yet.', actions, rowKey = 'id' }) {
  if (!rows?.length) {
    return el('div', { class: 'table-wrap' }, [emptyState({ title: 'No rows', message: emptyMessage, icon: '📋' })]);
  }

  const head = el('thead', {
    children: [
      el('tr', {
        children: [
          ...columns.map((column) =>
            el('th', {
              text: column.label,
              attrs: { scope: 'col', ...(column.numeric ? { class: 'table__numeric' } : {}) },
            }),
          ),
          actions ? el('th', { text: 'Actions', attrs: { scope: 'col' } }) : null,
        ].filter(Boolean),
      }),
    ],
  });

  const body = el('tbody', {
    children: rows.map((row) => {
      const cells = columns.map((column) => {
        const raw = column.value ? column.value(row) : row[column.key];
        const content = column.render ? column.render(row) : humanize(raw);
        const cell = el('td', { attrs: { 'data-label': column.label, ...(column.numeric ? { class: 'table__numeric' } : {}) } });
        if (content instanceof Node) cell.append(content);
        else cell.textContent = content === null || content === undefined || content === '' ? '—' : String(content);
        return cell;
      });

      if (actions) {
        cells.push(
          el('td', {
            attrs: { 'data-label': 'Actions' },
            children: [
              el('div', {
                class: 'table__actions',
                children: actions(row).map((action) =>
                  el('button', {
                    class: `btn btn--sm ${action.tone ? `btn--${action.tone}` : ''}`,
                    text: action.label,
                    attrs: { type: 'button', ...(action.disabled ? { disabled: '' } : {}) },
                    on: { click: () => action.onClick(row) },
                  }),
                ),
              }),
            ],
          }),
        );
      }

      const status = row.status ?? row.state;
      return el('tr', {
        attrs: { ...(row[rowKey] ? { 'data-id': String(row[rowKey]) } : {}), ...(status ? { 'data-status': String(status) } : {}) },
        children: cells,
      });
    }),
  });

  const node = el('table', {
    class: 'table',
    children: [caption ? el('caption', { text: caption }) : null, head, body].filter(Boolean),
  });

  return el('div', { class: 'table-wrap' }, [node]);
}

/** Convenience: render a table straight into a container. */
export function renderTable(container, options) {
  container.replaceChildren(table(options));
  container.setAttribute('aria-busy', 'false');
  return container;
}
