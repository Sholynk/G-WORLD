/**
 * Page — request a password reset.
 *
 * The response is deliberately identical whether or not the address exists, so
 * this page must not "helpfully" tell the visitor which case they hit.
 */
import { api } from '../core/api.js';
import { qs } from '../core/dom.js';
import { wireForm } from '../components/form.js';
import { pageError } from './_shared.js';

export async function init({ signal } = {}) {
  const form = qs('[data-forgot-form]');
  wireForm(form, async (values, { setStatus }) => {
    setStatus('Sending…');
    try {
      await api.post('/auth/forgot-password', { email: values.email }, { signal });
    } catch (error) {
      if (error?.code === 'RATE_LIMITED') {
        setStatus('Too many requests from this network. Please try again in a few minutes.', 'error');
        return;
      }
      throw error;
    }
    setStatus('If an account exists for that address, a reset link is on its way. It expires in one hour.', 'success');
  });
}
