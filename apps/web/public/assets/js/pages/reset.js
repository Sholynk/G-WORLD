/**
 * Page — reset password.
 *
 * The page asks for the e-mail address on the account and asks the API to send
 * a reset link. The answer is deliberately the same whether or not the address
 * exists: telling a stranger which e-mail addresses have accounts would leak
 * the platform's user list.
 */
import { api } from '../core/api.js';
import { qs } from '../core/dom.js';
import { wireForm } from '../components/form.js';
import { toastSuccess } from '../components/toast.js';

export async function init() {
  const form = qs('[data-reset-form]');
  if (!form) return;

  wireForm(form, async (values, { setStatus }) => {
    setStatus('Sending the reset link…');
    await api.post('/auth/forgot-password', { email: values.email });
    toastSuccess('If that address has an account, the reset link is on its way.');
    setStatus('If that address has an account, a reset link is on its way.', 'success');
  });
}
