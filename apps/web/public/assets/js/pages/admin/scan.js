/**
 * Admin page — QR / code lookup.
 *
 * A student card carries a QR code; scanning it with any camera opens the public
 * verification page. This screen is for staff who are handed a code printed on
 * paper: paste it and the record comes back from the API.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { formatDate, formatNumber, humanize } from '../../core/format.js';
import { toastError } from '../../components/toast.js';
import { requireStaff } from './_shared.js';

function row(term, value, mono = false) {
  return el('div', { children: [el('dt', { text: term }), el('dd', { class: mono ? 'mono' : '', text: String(value ?? '—') })] });
}

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const form = qs('[data-scan-form]');
  const resultHost = qs('[data-scan-result]');
  const status = qs('[data-scan-status]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const code = qs('#code').value.trim().toUpperCase();
    status.textContent = 'Looking up…';
    resultHost.hidden = true;

    try {
      // Student cards use the qr endpoint; certificate codes go through
      // verification, which is the same public check an employer would run.
      if (/^GW-STUDENT/.test(code)) {
        // Two reads: the QR record itself (which proves the code exists and is
        // not revoked) and the public student identity behind it.
        const [record, student] = await Promise.all([
          api.get(`/admin/qr/${encodeURIComponent(code)}`, { signal }),
          api.get(`/verify/student/${encodeURIComponent(code)}`, { signal }).catch(() => null),
        ]);
        const identity = student?.identity ?? student ?? {};
        resultHost.replaceChildren(
          el('section', {
            class: 'card',
            children: [
              el('div', {
                class: 'card__section stack-sm',
                children: [
                  el('p', {
                    class: `badge ${record.revoked ? 'badge--danger' : 'badge--success'}`,
                    text: record.revoked ? 'Code revoked' : 'Student code recognised',
                  }),
                  el('h2', { class: 'card__title', text: identity.name ?? 'Student' }),
                ],
              }),
              el('div', {
                class: 'card__footer',
                children: [
                  el('dl', {
                    class: 'detail-list',
                    children: [
                      row('Student number', identity.student_number, true),
                      row('Email', identity.email),
                      row('Member since', identity.member_since ? formatDate(identity.member_since) : '—'),
                      row('Courses enrolled', formatNumber(identity.courses_enrolled ?? 0)),
                      row('Courses completed', formatNumber(identity.courses_completed ?? 0)),
                      row('Certificates', formatNumber(identity.certificates ?? 0)),
                      row('Times scanned', formatNumber(record.scan_count ?? 0)),
                      row('Expires', record.expires_at ? formatDate(record.expires_at) : 'No expiry'),
                    ],
                  }),
                ],
              }),
              el('div', {
                class: 'card__footer',
                children: [
                  el('a', {
                    class: 'btn btn--sm',
                    text: 'Open public verification',
                    attrs: { href: `/verify.html?code=${encodeURIComponent(code)}` },
                  }),
                ],
              }),
            ],
          }),
        );
        status.textContent = 'Student record found.';
        status.className = 'form-status form-status--success';
      } else {
        const certificate = await api.get(`/verify/certificate/${encodeURIComponent(code)}`, { signal });
        resultHost.replaceChildren(
          el('section', {
            class: 'card',
            children: [
              el('div', {
                class: 'card__section stack-sm',
                children: [
                  el('p', {
                    class: `badge ${certificate.valid ? 'badge--success' : 'badge--danger'}`,
                    text: certificate.valid ? 'Valid certificate' : 'Revoked or invalid',
                  }),
                  el('h2', { class: 'card__title', text: certificate.course_title ?? 'Certificate' }),
                  el('p', { class: 'muted mb-0', text: certificate.holder_name ?? '' }),
                ],
              }),
              el('div', {
                class: 'card__footer',
                children: [
                  el('dl', {
                    class: 'detail-list',
                    children: [
                      row('Certificate number', certificate.certificate_number, true),
                      row('Verification code', certificate.verification_code, true),
                      row('Student number', certificate.student_number, true),
                      row('Grade', humanize(certificate.grade)),
                      row('Issued', formatDate(certificate.issued_at)),
                    ],
                  }),
                ],
              }),
            ],
          }),
        );
        status.textContent = certificate.valid ? 'Certificate found and valid.' : 'Certificate found, not valid.';
        status.className = 'form-status form-status--success';
      }
      resultHost.hidden = false;
    } catch (error) {
      status.className = 'form-status form-status--error';
      status.textContent = error.message;
      toastError(error.message);
    }
  });
}
