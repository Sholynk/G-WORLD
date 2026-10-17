/**
 * Page — log in.
 *
 * The session is an HttpOnly cookie set by the API; this page never sees a
 * token. After a successful sign-in the session cache is refreshed and the
 * learner is returned to `?next=` (validated to be a same-site path).
 */
import { api } from '../core/api.js';
import { qs, queryParam } from '../core/dom.js';
import { clearSessionCache, nextPath } from '../core/session.js';
import { wireForm } from '../components/form.js';
import { toastSuccess } from '../components/toast.js';

export async function init() {
  const form = qs('[data-login-form]');
  if (!form) return;

  const destination = nextPath('/dashboard.html');
  const status = qs('[data-form-status]', form);

  if (queryParam('error')) {
    status.textContent = 'Please log in to continue.';
  } else if (queryParam('next')) {
    status.textContent = 'Log in to continue where you were.';
  }

  wireForm(form, async (values, { setStatus }) => {
    setStatus('Logging in…');
    try {
      await api.post('/auth/login', {
        email: values.email,
        password: values.password,
        remember: true,
      });
    } catch (error) {
      // 403 EMAIL_NOT_VERIFIED is actionable: point at the resend page.
      if (error?.code === 'EMAIL_NOT_VERIFIED') {
        setStatus(error.message, 'error');
        return;
      }
      throw error;
    }

    clearSessionCache();
    toastSuccess('You are signed in.');
    setStatus('Signed in — taking you to your dashboard…', 'success');
    window.location.assign(destination);
  });
}
