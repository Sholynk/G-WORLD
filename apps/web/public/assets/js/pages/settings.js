/**
 * Page — settings.
 *
 * Three independent tools: change the password, manage the QR identity card, and
 * review the devices signed in to the account. Revoking a session is confirmed,
 * and revoking the *current* session signs the user out — the page says so.
 */
import { api } from '../core/api.js';
import { el, qs } from '../core/dom.js';
import { formatDateTime, formatRelative } from '../core/format.js';
import { emptyState } from '../components/empty-state.js';
import { confirmAction } from '../components/modal.js';
import { qrCard } from '../components/qrcode.js';
import { statusBadge } from '../components/progress.js';
import { toastError, toastSuccess } from '../components/toast.js';
import { wireForm } from '../components/form.js';
import { clearSessionCache } from '../core/session.js';
import { fill, needSession, pageError, setBusy } from './_shared.js';

async function loadQr(signal) {
  const host = qs('[data-qr-card]');
  setBusy(host, true);
  const qr = await api.get('/me/qr', { signal });

  const card = qrCard(qr, {
    onRotate: async () => {
      const confirmed = await confirmAction({
        title: 'Issue a new QR code?',
        body: 'The old code stops working immediately. Print or save the new one if you use it on a badge.',
        confirmLabel: 'Issue new code',
        onConfirm: async () => {
          await api.post('/me/qr/rotate', {});
        },
      });
      if (!confirmed) return;
      toastSuccess('New QR code issued.');
      clearSessionCache();
      loadQr(signal).catch((error) => toastError(error.message));
    },
  });

  host.replaceChildren(card);
  fill('[data-qr-code]', qr.code ?? '—');
  fill(
    '[data-qr-meta]',
    `${qr.scan_count ? `Scanned ${qr.scan_count} time(s). ` : ''}${
      qr.identity?.student_number ? `Student ${qr.identity.student_number} · ` : ''
    }${qr.identity?.certificates ? `${qr.identity.certificates} certificate(s)` : 'No certificates yet'}`,
  );
  setBusy(host, false);
}

async function loadSessions(signal) {
  const host = qs('[data-session-list]');
  setBusy(host, true);
  const sessions = await api.get('/auth/sessions', { signal });

  if (!sessions.length) {
    host.replaceChildren(emptyState({ title: 'No active sessions', message: 'Nothing is signed in right now.', icon: '💻' }));
    setBusy(host, false);
    return;
  }

  host.replaceChildren(
    el('table', {
      class: 'table',
      children: [
        el('caption', { text: 'Devices signed in to your account' }),
        el('thead', {
          children: [
            el('tr', {
              children: ['Device', 'Started', 'Last seen', 'Expires', ''].map((label) =>
                el('th', { text: label, attrs: { scope: 'col' } }),
              ),
            }),
          ],
        }),
        el('tbody', {
          children: sessions.map((session) =>
            el('tr', {
              children: [
                el('td', {
                  attrs: { 'data-label': 'Device' },
                  children: [
                    el('span', { text: session.device ?? 'Unknown device' }),
                    session.current ? el('span', { class: 'badge badge--info', text: 'This device' }) : null,
                  ],
                }),
                el('td', { attrs: { 'data-label': 'Started' }, text: formatRelative(session.created_at), title: formatDateTime(session.created_at) }),
                el('td', { attrs: { 'data-label': 'Last seen' }, text: formatRelative(session.last_seen_at), title: formatDateTime(session.last_seen_at) }),
                el('td', { attrs: { 'data-label': 'Expires' }, text: formatDateTime(session.expires_at) }),
                el('td', {
                  attrs: { 'data-label': 'Actions' },
                  children: [
                    el('button', {
                      class: 'btn btn--sm btn--danger',
                      text: session.current ? 'Sign out this device' : 'Sign out',
                      attrs: { type: 'button' },
                      on: {
                        click: async () => {
                          const confirmed = await confirmAction({
                            title: 'Sign out this device?',
                            body: session.current
                              ? 'This is the browser you are using, so you will be signed out now.'
                              : 'That device will need to sign in again.',
                            confirmLabel: 'Sign out',
                            tone: 'danger',
                            onConfirm: async () => {
                              await api.delete(`/auth/sessions/${encodeURIComponent(session.id)}`);
                            },
                          });
                          if (!confirmed) return;
                          clearSessionCache();
                          if (session.current) {
                            window.location.assign('/login.html');
                            return;
                          }
                          toastSuccess('That session was signed out.');
                          await loadSessions(signal);
                        },
                      },
                    }),
                  ],
                }),
              ],
            }),
          ),
        }),
      ],
    }),
  );
  setBusy(host, false);
}

export async function init({ signal, session }) {
  const current = await needSession(session);
  if (!current) return;

  // --------------------------------------------------------- password form
  const passwordForm = qs('[data-password-form]');
  wireForm(passwordForm, async (values, { setStatus }) => {
    setStatus('Updating…');
    await api.post('/auth/change-password', {
      current_password: values.current_password,
      new_password: values.new_password,
    });
    passwordForm.reset();
    clearSessionCache();
    setStatus('Password updated. Other devices stay signed in — revoke them below if you want.', 'success');
    toastSuccess('Password changed.');
  });

  try {
    await Promise.all([loadQr(signal), loadSessions(signal)]);
  } catch (error) {
    pageError(error, () => window.location.reload());
    return;
  }

  qs('[data-reload-sessions]').addEventListener('click', () => {
    loadSessions(signal).catch((error) => toastError(error.message));
  });
}
