/**
 * Page — a single certificate.
 *
 * Reads the learner's own certificate (`GET /me/certificates/:id`) so a signed-in
 * holder sees the full record, including anything since revoked. A public
 * visitor is sent to the verification page instead of being told the record
 * does not exist.
 */
import { api } from '../core/api.js';
import { el, qs, queryParam } from '../core/dom.js';
import { config } from '../core/config.js';
import { formatDate, formatPercent, humanize } from '../core/format.js';
import { toastError } from '../components/toast.js';
import { fill, needSession, pageError } from './_shared.js';

export async function init({ signal, session }) {
  const certificateId = queryParam('id');
  if (!certificateId) {
    pageError({ message: 'No certificate was named in the address.' });
    return;
  }

  const current = await needSession(session);
  if (!current) return;

  const card = qs('[data-certificate-card]');

  try {
    const certificate = await api.get(`/me/certificates/${encodeURIComponent(certificateId)}`, { signal });

    document.title = `${certificate.certificate_number} · G WORLD`;
    fill('[data-certificate-crumb]', certificate.certificate_number);
    fill('[data-certificate-title]', certificate.title);
    fill(
      '[data-certificate-holder]',
      `${certificate.holder?.name ?? current.user.profile?.display_name ?? ''}${
        certificate.holder?.student_number ? ` · ${certificate.holder.student_number}` : ''
      }`,
    );
    fill('[data-certificate-number]', certificate.certificate_number);
    fill('[data-certificate-code]', certificate.verification_code);
    fill('[data-certificate-grade]', humanize(certificate.grade));
    fill(
      '[data-certificate-score]',
      certificate.final_score_percent === null || certificate.final_score_percent === undefined
        ? 'Not scored (completion certificate)'
        : formatPercent(certificate.final_score_percent),
    );
    fill('[data-certificate-issued]', formatDate(certificate.issued_at));

    const status = qs('[data-certificate-status]');
    status.replaceChildren(
      el('span', {
        class: `badge ${certificate.valid ? 'badge--success' : 'badge--danger'}`,
        text: certificate.valid ? 'Valid' : `Revoked${certificate.revoked_at ? ` on ${formatDate(certificate.revoked_at)}` : ''}`,
      }),
    );

    qs('[data-certificate-verify]').setAttribute(
      'href',
      `/verify.html?code=${encodeURIComponent(certificate.verification_code)}`,
    );

    const printButton = qs('[data-certificate-print]');
    printButton.addEventListener('click', () => window.print());

    // Public URL, shown so the holder can paste it into a CV or email.
    const share = el('p', {
      class: 'subtle mono',
      text: `${window.location.origin}/verify.html?code=${certificate.verification_code}`,
    });
    card.after(
      el('div', {
        class: 'stack-sm',
        children: [
          share,
          el('button', {
            class: 'btn btn--sm btn--ghost',
            text: 'Copy verification link',
            attrs: { type: 'button' },
            on: {
              click: async (event) => {
                try {
                  await navigator.clipboard.writeText(share.textContent);
                  event.currentTarget.textContent = 'Copied';
                } catch {
                  toastError('Your browser blocked clipboard access — copy the link above by hand.');
                }
              },
            },
          }),
        ],
      }),
    );
    card.setAttribute('aria-busy', 'false');
  } catch (error) {
    pageError(error, () => window.location.reload());
  }
}
