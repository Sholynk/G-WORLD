/**
 * Page — sign in.
 *
 * The session is an HttpOnly cookie set by the API; this page never sees a
 * token. After a successful sign-in the session cache is refreshed and the user
 * is returned to `?next=` (validated to be a same-site path).
 */
import { api } from '../core/api.js';
import { qs, queryParam } from '../core/dom.js';
import { describeError } from '../core/errors.js';
import { clearSessionCache, nextPath } from '../core/session.js';
import { wireForm, wirePasswordToggles } from '../components/form.js';
import { toastSuccess } from '../components/toast.js';
import { pageError } from './_shared.js';

export async function init({ signal } = {}) {
  wirePasswordToggles(document);

  const form = qs('[data-login-form]');
  if (!form) return;

  const destination = nextPath('/dashboard.html');
  const notice = queryParam('error');
  if (notice) {
    qs('[data-form-status]').textContent = 'Please sign in to continue.';
  }
  if (queryParam('next')) {
    qs('[data-form-status]').textContent = 'Sign in to continue where you were.';
  }

  wireForm(form, async (values, { setStatus }) => {
    setStatus('Signing in…');
    try {
      await api.post('/auth/login', {
        email: values.email,
        password: values.password,
        remember: Boolean(values.remember),
      });
    } catch (error) {
      // 403 EMAIL_NOT_VERIFIED is actionable: offer the resend page.
      if (error?.code === 'EMAIL_NOT_VERIFIED') {
        setStatus(error.message, 'error');
        const link = document.createElement('a');
        link.className = 'btn btn--sm mt-4';
        link.href = `/verify-email.html?email=${encodeURIComponent(values.email)}`;
        link.textContent = 'Resend the confirmation link';
        qs('[data-form-status]').after(link);
        return;
      }
      throw error;
    }

    clearSessionCache();
    toastSuccess('Signed in. Welcome back.', 'G WORLD');
    setStatus('Signed in — taking you to your dashboard…', 'success');
    window.location.assign(destination);
  });
}
