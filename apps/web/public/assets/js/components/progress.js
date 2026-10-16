/**
 * Components — progress indicators.
 *
 * Progress is computed by the API from lesson records; these helpers only
 * display the number they are given. Both variants are real ARIA progressbars so
 * a screen reader announces "50 percent" instead of reading a coloured bar.
 */
import { el } from '../core/dom.js';
import { formatPercent, humanize } from '../core/format.js';

const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) ?? 0)));

/** `<span class="progress">` with a labelled bar. */
export function progressBar(percent, { label = null, detail = null } = {}) {
  const value = clamp(percent);
  return el('div', {
    class: 'stack-sm',
    children: [
      el('div', {
        class: 'progress__label',
        children: [
          el('span', { text: label ?? 'Progress' }),
          el('span', { text: formatPercent(value) }),
        ],
      }),
      el('span', {
        class: 'progress',
        attrs: {
          role: 'progressbar',
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuenow': String(value),
          'aria-label': label ?? 'Progress',
        },
        children: [
          el('span', {
            class: 'progress__bar',
            attrs: { style: `--progress-value: ${value}%` },
          }),
        ],
      }),
      detail ? el('p', { class: 'subtle', text: detail }) : null,
    ],
  });
}

/** Circular progress, used beside "continue learning" cards. */
export function progressRing(percent, { label = 'Progress' } = {}) {
  const value = clamp(percent);
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'progress-ring');
  svg.setAttribute('viewBox', '0 0 80 80');
  svg.setAttribute('role', 'progressbar');
  svg.setAttribute('aria-valuemin', '0');
  svg.setAttribute('aria-valuemax', '100');
  svg.setAttribute('aria-valuenow', String(value));
  svg.setAttribute('aria-label', label);

  const circle = (className, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    node.setAttribute('class', className);
    node.setAttribute('cx', '40');
    node.setAttribute('cy', '40');
    node.setAttribute('r', String(radius));
    for (const [key, attrValue] of Object.entries(attrs)) node.setAttribute(key, attrValue);
    return node;
  };

  svg.append(
    circle('progress-ring__track', {}),
    circle('progress-ring__value', {
      'stroke-dasharray': `${dash} ${circumference - dash}`,
    }),
  );

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('class', 'progress-ring__text');
  text.setAttribute('x', '40');
  text.setAttribute('y', '44');
  text.setAttribute('text-anchor', 'middle');
  text.textContent = formatPercent(value);
  svg.append(text);

  return svg;
}

/** Badge for an enrolment status (`active` → "Active"). */
export function statusBadge(status) {
  const tone =
    {
      active: 'badge--info',
      completed: 'badge--success',
      cancelled: 'badge',
      expired: 'badge--warning',
      suspended: 'badge--danger',
      revoked: 'badge--danger',
      pending_verification: 'badge--warning',
      draft: 'badge',
      published: 'badge--success',
      archived: 'badge',
    }[status] ?? 'badge';
  return el('span', { class: `badge ${tone}`, text: humanize(status) });
}
