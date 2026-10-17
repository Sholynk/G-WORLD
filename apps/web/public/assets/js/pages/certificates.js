/**
 * Page — my certificates.
 *
 * Each certificate is shown with its QR code, which opens the public
 * verification page, and a download button that leads to the printable
 * certificate. The QR image is rendered by the API, so a code cannot be forged
 * in the browser.
 */
import { api } from '../core/api.js';
import { el, qs } from '../core/dom.js';
import { config } from '../core/config.js';
import { formatDate, humanize } from '../core/format.js';
import { emptyState } from '../components/empty-state.js';
import { needSession, pageError, setBusy } from './_shared.js';

export async function init({ signal, session }) {
  const current = await needSession(session);
  if (!current) return;

  const host = qs('[data-certificates-list]');
  if (!host) return;

  try {
    const certificates = await api.get('/me/certificates', { signal });

    if (!certificates?.length) {
      host.replaceChildren(
        emptyState({
          title: 'No certificates yet',
          message: 'Complete every lesson in a course to earn one. Your progress is saved as you go.',
          action: { label: 'Go to my courses', href: '/my-courses.html' },
        }),
      );
      setBusy(host, false);
      return;
    }

    host.replaceChildren(
      ...certificates.map((certificate) => {
        const verifyHref = `/verify.html?code=${encodeURIComponent(certificate.verification_code)}`;

        return el('article', {
          class: 'card',
          children: [
            el('div', {
              class: 'card__section stack-sm',
              children: [
                el('span', {
                  class: 'tag',
                  text: certificate.valid ? 'Valid certificate' : 'Revoked certificate',
                }),
                el('h3', {
                  class: 'card__title',
                  children: [
                    el('a', {
                      text: certificate.title ?? certificate.course?.title ?? 'Certificate',
                      attrs: { href: `/certificate.html?id=${encodeURIComponent(certificate.id)}` },
                    }),
                  ],
                }),
                el('dl', {
                  class: 'detail-list',
                  children: [
                    el('div', {
                      children: [
                        el('dt', { text: 'Number' }),
                        el('dd', { class: 'mono', text: certificate.certificate_number ?? '—' }),
                      ],
                    }),
                    el('div', {
                      children: [
                        el('dt', { text: 'Grade' }),
                        el('dd', { text: humanize(certificate.grade) }),
                      ],
                    }),
                    el('div', {
                      children: [
                        el('dt', { text: 'Issued' }),
                        el('dd', { text: formatDate(certificate.issued_at) }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            el('div', {
              class: 'card__section',
              children: [
                el('div', {
                  class: 'cluster',
                  children: [
                    el('a', {
                      class: 'qr-code',
                      attrs: {
                        href: verifyHref,
                        title: 'Open the public verification page',
                        'aria-label': 'Open the public verification page for this certificate',
                      },
                      children: [
                        el('img', {
                          attrs: {
                            src: `${config.apiBaseUrl}/me/certificates/${encodeURIComponent(certificate.id)}/qr.svg`,
                            alt: 'QR code that opens the public verification page',
                            width: '96',
                            height: '96',
                            loading: 'lazy',
                          },
                        }),
                      ],
                    }),
                    el('div', {
                      class: 'btn-row',
                      children: [
                        el('a', {
                          class: 'btn',
                          text: 'Download',
                          attrs: { href: `/certificate.html?id=${encodeURIComponent(certificate.id)}` },
                        }),
                        el('a', {
                          class: 'btn o',
                          text: 'Verify',
                          attrs: { href: verifyHref },
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        });
      }),
    );
    setBusy(host, false);
  } catch (error) {
    setBusy(host, false);
    pageError(error, () => init({ signal, session: current }));
  }
}
