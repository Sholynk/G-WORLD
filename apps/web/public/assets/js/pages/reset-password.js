/**
 * Page — set a new password from a reset link.
 *
 * The token comes from `?token=`; the API accepts it once, so the page warns
 * that a second attempt will fail and points back to the request form.
 */
import { api } from '../core/api.js';
import { qs, queryParam } from '../core/dom.js';
import { wireForm, wirePasswordToggles } from '../components/form.js';
import { toastSuccess } from '../components/toast.js';
import { fill } from './_shared.js';

export async function init({ signal } = {}) {
  wirePasswordToggles(document);

  const form = qs('[data-reset-form]');
  const token = queryParam('token');

  if (!token) {
    form.hidden = true;
    const status = qs('[data-form-status]');
    status.className = 'alert alert--warning';
    status.textContent =
      'This page needs the link from your reset email. Request a new one from the “Forgot your password?” page.';
    fill('[data-reset-lede]', 'No reset token found in the address.');
    return;
  }

  fill('[data-reset-lede]', 'Choose something you have not used before. The link works once.');

  wireForm(form, async (values, { setStatus }) => {
    if (values.password !== values.confirm) {
      setStatus('The two passwords do not match.', 'error');
      return;
    }
    setStatus('Updating your password…');
    await api.post('/auth/reset-password', { token, password: values.password }, { signal });
    toastSuccess('Password updated. Sign in with your new password.');
    setStatus('Password updated — taking you to sign in…', 'success');
    setTimeout(() => window.location.assign('/login.html'), 1200);
  });
}
