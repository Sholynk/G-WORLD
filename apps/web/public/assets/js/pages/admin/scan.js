/**
 * Admin page — QR scanner.
 *
 * The camera preview is the browser's own: `getUserMedia` puts the rear
 * camera on screen, and where the browser can decode QR codes natively
 * (`BarcodeDetector`) a scanned code is verified without touching the
 * keyboard. Staff can always type or paste the code instead.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { formatDate, humanize } from '../../core/format.js';
import { toastError } from '../../components/toast.js';
import { pageError, setBusy } from '../_shared.js';
import { requireStaff } from './_shared.js';

function row(term, value) {
  return el('div', {
    children: [el('dt', { text: term }), el('dd', { text: value === null || value === undefined ? '—' : String(value) })],
  });
}

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const form = qs('[data-scan-form]');
  const status = qs('[data-scan-status]');
  const resultSection = qs('[data-scan-result]');
  const resultCard = qs('[data-scan-result-card]');
  const video = qs('[data-scan-video]');
  const frame = qs('[data-scan-frame]');
  const startButton = qs('[data-scan-start]');
  const stopButton = qs('[data-scan-stop]');

  if (!form) return;

  let stream = null;
  let detector = null;
  let scanning = false;

  /** Looks a code up and shows the certificate behind it. */
  async function verify(rawCode) {
    const code = String(rawCode ?? '').trim().toUpperCase();
    if (!code) return;

    status.textContent = 'Looking up…';
    status.className = 'form-status';
    resultSection.hidden = true;

    try {
      const certificate = await api.get(`/verify/certificate/${encodeURIComponent(code)}`, { signal });

      resultCard.replaceChildren(
        el('div', {
          class: 'card__section stack-sm',
          children: [
            el('span', { class: 'tag', text: certificate.valid ? 'Verified' : 'Revoked' }),
            el('h3', {
              class: 'card__title',
              text: certificate.course_title ?? 'Certificate',
            }),
            el('p', { class: 'muted mb-0', text: certificate.holder_name ?? 'G WORLD learner' }),
          ],
        }),
        el('div', {
          class: 'card__section',
          children: [
            el('dl', {
              class: 'detail-list',
              children: [
                row('Student', certificate.holder_name),
                row('Course', certificate.course_title),
                row('Date issued', formatDate(certificate.issued_at)),
                row('Certificate number', certificate.certificate_number),
                row('Verification code', certificate.verification_code),
                row('Grade', humanize(certificate.grade)),
              ],
            }),
          ],
        }),
        el('div', {
          class: 'card__section',
          children: [
            el('a', {
              class: 'btn o',
              text: 'Open public verification',
              attrs: { href: `/verify.html?code=${encodeURIComponent(code)}` },
            }),
          ],
        }),
      );

      resultSection.hidden = false;
      status.textContent = certificate.valid ? 'Certificate verified.' : 'Certificate found, but it is revoked.';
      status.className = 'form-status form-status--success';
    } catch (error) {
      status.className = 'form-status form-status--error';
      status.textContent = error.message;
      toastError(error.message);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    verify(qs('#code').value);
  });

  /* ------------------------------------------------------------- camera */

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'This browser cannot open the camera — type the code instead.';
      status.className = 'form-status form-status--error';
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      startButton.hidden = true;
      stopButton.hidden = false;

      // Native QR decoding where the browser supports it.
      if ('BarcodeDetector' in window) {
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        scanning = true;
        watch();
      } else {
        status.textContent = 'Camera on. Type or paste the code to verify it.';
      }
    } catch (error) {
      status.textContent = 'The camera could not be opened — type the code instead.';
      status.className = 'form-status form-status--error';
    }
  }

  function stopCamera() {
    scanning = false;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    if (video) {
      video.srcObject = null;
      video.hidden = true;
    }
    startButton.hidden = false;
    stopButton.hidden = true;
  }

  /** Watches the video frames for a QR code and verifies the first one seen. */
  async function watch() {
    if (!scanning || !detector || !video) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length) {
        scanning = false;
        await verify(codes[0].rawValue);
        return;
      }
    } catch {
      // A frame that cannot be decoded is normal; keep watching.
    }
    if (scanning) requestAnimationFrame(watch);
  }

  startButton?.addEventListener('click', startCamera);
  stopButton?.addEventListener('click', stopCamera);
  window.addEventListener('pagehide', stopCamera);

  setBusy(qs('[data-scan-form]'), false);
}
