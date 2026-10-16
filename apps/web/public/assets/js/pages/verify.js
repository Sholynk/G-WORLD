/**
 * Page — public verification.
 *
 * The one page that must work without an account: an employer checking a
 * credential. `GET /verify/certificate/:code` and `GET /verify/student/:code`
 * are public and rate-limited; this page only displays what they return, so a
 * forged code simply comes back invalid.
 */
import { api } from '../core/api.js';
import { el, qs, queryParam } from '../core/dom.js';
import { formatDate, formatNumber, humanize } from '../core/format.js';
import { emptyState } from '../components/empty-state.js';
import { fill, pageError, toggle } from './_shared.js';

function detail(term, value, { mono = false } = {}) {
  return el('div', {
    children: [
      el('dt', { text: term }),
      el('dd', { class: mono ? 'mono' : '', text: value ?? '—' }),
    ],
  });
}

function certificatePanel(result) {
  return el('div', {
    class: 'card',
    children: [
      el('div', {
        class: 'card__section stack-sm',
        children: [
          el('p', {
            class: `badge ${result.valid ? 'badge--success' : 'badge--danger'}`,
            text: result.valid ? 'Valid certificate' : result.revoked_at ? 'Revoked' : 'Not valid',
          }),
          el('h2', { class: 'card__title', text: result.course_title ?? 'Certificate' }),
          el('p', { class: 'muted mb-0', text: result.holder_name ? `Awarded to ${result.holder_name}` : '' }),
        ],
      }),
      el('div', {
        class: 'card__footer',
        children: [
          el('dl', {
            class: 'detail-list',
            children: [
              detail('Certificate number', result.certificate_number, { mono: true }),
              detail('Verification code', result.verification_code, { mono: true }),
              detail('Student number', result.student_number, { mono: true }),
              detail('Department', result.department_name),
              detail('Grade', humanize(result.grade)),
              detail('Issued', formatDate(result.issued_at)),
              ...(result.revoked_at ? [detail('Revoked', formatDate(result.revoked_at))] : []),
            ],
          }),
        ],
      }),
    ],
  });
}

function studentPanel(result) {
  const identity = result.identity ?? result;
  return el('div', {
    class: 'card',
    children: [
      el('div', {
        class: 'card__section stack-sm',
        children: [
          el('p', { class: 'badge badge--info', text: 'G WORLD student' }),
          el('h2', { class: 'card__title', text: identity.name ?? 'Student' }),
          el('p', { class: 'muted mb-0', text: 'This code confirms the holder has a G WORLD learning record.' }),
        ],
      }),
      el('div', {
        class: 'card__footer',
        children: [
          el('dl', {
            class: 'detail-list',
            children: [
              detail('Student number', identity.student_number, { mono: true }),
              detail('Member since', identity.member_since ? formatDate(identity.member_since) : '—'),
              detail('Courses enrolled', formatNumber(identity.courses_enrolled ?? 0)),
              detail('Courses completed', formatNumber(identity.courses_completed ?? 0)),
              detail('Certificates', formatNumber(identity.certificates ?? 0)),
            ],
          }),
        ],
      }),
    ],
  });
}

export async function init({ signal } = {}) {
  const form = qs('[data-verify-form]');
  const input = qs('#code');
  const status = qs('[data-verify-status]');
  const resultHost = qs('[data-verify-result]');

  async function verify(code) {
    status.className = 'form-status';
    status.textContent = 'Checking…';
    resultHost.hidden = true;
    resultHost.replaceChildren();

    try {
      // Certificates first: their codes are longer and start with GW-CERT.
      const value = code.trim().toUpperCase();
      let result;
      let kind;
      if (/^GW-STUDENT/.test(value)) {
        result = await api.get(`/verify/student/${encodeURIComponent(value)}`, { signal });
        kind = 'student';
      } else {
        result = await api.get(`/verify/certificate/${encodeURIComponent(value)}`, { signal });
        kind = 'certificate';
      }

      if (kind === 'certificate') {
        resultHost.replaceChildren(certificatePanel(result));
        status.className = 'form-status form-status--success';
        status.textContent = result.valid
          ? 'Certificate found and valid.'
          : 'Certificate found, but it is not currently valid.';
      } else {
        resultHost.replaceChildren(studentPanel(result));
        status.className = 'form-status form-status--success';
        status.textContent = 'Student record found.';
      }
      resultHost.hidden = false;
    } catch (error) {
      status.className = 'form-status form-status--error';
      status.textContent = error.message;
      resultHost.replaceChildren(
        emptyState({
          icon: '🔍',
          title: 'Nothing matched that code',
          message: 'Check the code printed on the certificate or QR card. Codes are case-insensitive, and dashes are optional.',
        }),
      );
      resultHost.hidden = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    verify(input.value);
  });

  form.addEventListener('reset', () => {
    resultHost.hidden = true;
    resultHost.replaceChildren();
    status.textContent = '';
  });

  // Deep link: /verify.html?code=… verifies immediately (that is what the QR
  // code from a student card points at).
  const code = queryParam('code');
  if (code) {
    input.value = code;
    verify(code);
  }
}
