/**
 * Page — my certificates.
 *
 * Certificates cannot be edited or re-issued by the learner; a certificate is
 * created by the API when a course is genuinely complete. This page links each
 * one to its public verification URL, which is the whole point of the feature.
 */
import { api } from '../core/api.js';
import { el, qs } from '../core/dom.js';
import { config } from '../core/config.js';
import { formatDate, formatPercent, humanize } from '../core/format.js';
import { emptyState } from '../components/empty-state.js';
import { toastSuccess } from '../components/toast.js';
import { needSession, pageError, setBusy } from './_shared.js';

export async function init({ signal, session }) {
  const current = await needSession(session);
  if (!current) return;

  const host = qs('[data-certificate-list]');

  try {
    const certificates = await api.get('/me/certificates', { signal });

    if (!certificates.length) {
      host.replaceChildren(
        emptyState({
          title: 'No certificates yet',
          message: 'Complete every lesson in a course to earn one. Your progress is saved as you go.',
          action: { label: 'Go to my courses', href: '/my-courses.html' },
          icon: '🏅',
        }),
      );
      setBusy(host, false);
      return;
    }

    host.replaceChildren(
      ...certificates.map((certificate) =>
        el('article', {
          class: 'card',
          children: [
            el('div', {
              class: 'card__body stack-sm',
              children: [
                el('p', { class: 'card__eyebrow', text: certificate.valid ? 'Valid certificate' : 'Revoked certificate' }),
                el('h2', {
                  class: 'card__title',
                  children: [el('a', { text: certificate.title, attrs: { href: `/certificate.html?id=${encodeURIComponent(certificate.id)}` } })],
                }),
                el('dl', {
                  class: 'detail-list',
                  children: [
                    el('div', { children: [el('dt', { text: 'Number' }), el('dd', { class: 'mono', text: certificate.certificate_number })] }),
                    el('div', { children: [el('dt', { text: 'Code' }), el('dd', { class: 'mono', text: certificate.verification_code })] }),
                    el('div', { children: [el('dt', { text: 'Grade' }), el('dd', { text: humanize(certificate.grade) })] }),
                    el('div', { children: [el('dt', { text: 'Issued' }), el('dd', { text: formatDate(certificate.issued_at) })] }),
                  ],
                }),
              ],
            }),
            el('div', {
              class: 'card__footer cluster cluster--tight',
              children: [
                el('a', {
                  class: 'btn btn--sm btn--primary',
                  text: 'Open certificate',
                  attrs: { href: `/certificate.html?id=${encodeURIComponent(certificate.id)}` },
                }),
                el('a', {
                  class: 'btn btn--sm',
                  text: 'Public verification',
                  attrs: { href: `/verify.html?code=${encodeURIComponent(certificate.verification_code)}` },
                }),
                el('button', {
                  class: 'btn btn--sm btn--ghost',
                  text: 'Copy code',
                  attrs: { type: 'button' },
                  on: {
                    click: async (event) => {
                      await navigator.clipboard?.writeText(certificate.verification_code);
                      toastSuccess(`Copied ${certificate.verification_code}.`);
                      event.currentTarget.textContent = 'Copied';
                    },
                  },
                }),
              ],
            }),
          ],
        }),
      ),
    );
    setBusy(host, false);
  } catch (error) {
    pageError(error, () => window.location.reload());
  }
}
