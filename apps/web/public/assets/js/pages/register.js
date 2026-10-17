/**
 * Page — create an account.
 *
 * The form has the four fields from the template: full name, e-mail, password
 * and the password confirmation. The confirmation is checked here so the
 * learner is told immediately, and the real rules are enforced again by the
 * API. New accounts are always plain students — nothing on this page can
 * grant a role.
 */
import { api } from '../core/api.js';
import { qs } from '../core/dom.js';
import { wireForm } from '../components/form.js';
import { toastSuccess } from '../components/toast.js';

export async function init() {
  const form = qs('[data-register-form]');
  if (!form) return;

  wireForm(form, async (values, { setStatus }) => {
    if (values.password !== values.confirm_password) {
      setStatus('The two passwords do not match.', 'error');
      return;
    }

    setStatus('Creating your account…');
    const result = await api.post('/auth/register', {
      full_name: values.full_name,
      display_name: values.full_name,
      email: values.email,
      password: values.password,
      accepted_terms: Boolean(values.accepted_terms),
    });

    toastSuccess('Account created. Check your e-mail to confirm it.');
    setStatus('Account created — confirm your e-mail address to continue.', 'success');

    // In local development the API returns the verification token so the flow
    // can be completed without a real inbox. Never present in production.
    if (result?.debug_verification_token) {
      window.location.assign(`/verify-email.html?token=${encodeURIComponent(result.debug_verification_token)}`);
      return;
    }
    window.location.assign(`/verify-email.html?email=${encodeURIComponent(values.email)}`);
  });
}
