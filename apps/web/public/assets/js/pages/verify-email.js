/**
 * Page — confirm email.
 *
 * Arriving with `?token=` confirms immediately; arriving with only an address
 * offers to send a fresh link. The API always answers the same way to a resend
 * request, so this page cannot be used to find out which addresses exist.
 */
import { api } from '../core/api.js';
import { qs, queryParam } from '../core/dom.js';
import { wireForm } from '../components/form.js';
import { toastError, toastSuccess } from '../components/toast.js';
import { fill, pageError, toggle } from './_shared.js';

function showResult({ tone, badge, title, message }) {
  const card = qs('[data-verify-card]');
  const badgeNode = qs('[data-verify-badge]');
  badgeNode.className = `badge ${tone}`;
  badgeNode.textContent = badge;
  fill('[data-verify-message]', message);
  fill('[data-verify-lede]', title);
  card.hidden = false;
}

export async function init({ signal } = {}) {
  const token = queryParam('token');
  const email = queryParam('email');
  const resendSection = qs('[data-resend]');
  const resendInput = qs('#resend-email');

  if (email) resendInput.value = email;

  if (!token) {
    showResult({
      tone: 'badge--warning',
      badge: 'Waiting for your link',
      title: 'Confirm your email',
      message: email
        ? `Open the confirmation link we sent to ${email}. It works once and expires after 48 hours.`
        : 'Open the confirmation link from your inbox, or ask for a new one below.',
    });
    resendSection.hidden = false;
  } else {
    try {
      const result = await api.post('/auth/verify-email', { token }, { signal });
      showResult({
        tone: 'badge--success',
        badge: 'Confirmed',
        title: 'Your email is confirmed',
        message: result?.email ? `${result.email} is confirmed. You can sign in now.` : 'Your account is active. You can sign in now.',
      });
      toastSuccess('Email confirmed.');
    } catch (error) {
      showResult({
        tone: 'badge--danger',
        badge: 'Link not accepted',
        title: 'That link did not work',
        message: error.message,
      });
      resendSection.hidden = false;
    }
  }

  const form = qs('[data-resend-form]');
  wireForm(form, async (values, { setStatus }) => {
    setStatus('Sending…');
    try {
      await api.post('/auth/resend-verification', { email: values.email });
      setStatus('If that address has an unconfirmed account, a new link is on its way.', 'success');
    } catch (error) {
      // A rate limit is worth explaining rather than hiding.
      if (error?.code === 'RATE_LIMITED') {
        setStatus('You have asked for several links already. Please wait a few minutes.', 'error');
        return;
      }
      throw error;
    }
  });
}
