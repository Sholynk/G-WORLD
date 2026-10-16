/**
 * Components — QR identity card.
 *
 * The QR image is produced by the API (`GET /api/v1/me/qr?format=svg`), which
 * signs the payload and keeps the SVG generation on the server. The browser only
 * displays it, so the code cannot be forged client-side.
 */
import { el } from '../core/dom.js';
import { config } from '../core/config.js';
import { formatDate } from '../core/format.js';

/** `<img>` pointing at the API's SVG endpoint (cookies are sent: same origin). */
export function qrImage({ size = 220 } = {}) {
  return el('img', {
    attrs: {
      src: `${config.apiBaseUrl}/me/qr?format=svg`,
      alt: 'Your G WORLD identity QR code',
      width: String(size),
      height: String(size),
      decoding: 'async',
    },
  });
}

/** Full card: code, issue/expiry, and the rotate action (permission-checked server-side). */
export function qrCard(qr, { onRotate } = {}) {
  return el('div', {
    class: 'qr-card',
    children: [
      el('div', { class: 'qr-card__frame', children: [qrImage({ size: 200 })] }),
      el('p', { class: 'qr-card__code', text: qr?.code ?? qr?.payload ?? '—' }),
      el('p', {
        class: 'subtle',
        text: qr?.expires_at ? `Valid until ${formatDate(qr.expires_at)}` : 'No expiry recorded.',
      }),
      onRotate
        ? el('button', {
            class: 'btn btn--sm',
            text: 'Issue a new code',
            attrs: { type: 'button' },
            on: { click: () => onRotate() },
          })
        : null,
    ],
  });
}
