/**
 * Page — profile.
 *
 * The card holds the learner's full name, the e-mail address on the account
 * and a field for a new password. The API is the authority: the name is saved
 * with `PATCH /me/profile` and a new password goes through
 * `POST /auth/change-password`, which asks for the current password first.
 */
import { api } from '../core/api.js';
import { el, qs } from '../core/dom.js';
import { wireForm } from '../components/form.js';
import { openModal } from '../components/modal.js';
import { toastSuccess } from '../components/toast.js';
import { needSession, pageError } from './_shared.js';

/**
 * Asks for the current password in a dialog and hands the value to `onSubmit`.
 * The password is never stored anywhere but the request body.
 */
function askForCurrentPassword(onSubmit) {
  const input = el('input', {
    attrs: {
      id: 'current-password',
      name: 'current_password',
      type: 'password',
      autocomplete: 'current-password',
      required: '',
    },
  });

  openModal({
    title: 'Confirm your current password',
    body: el('div', {
      class: 'field',
      children: [
        el('label', { text: 'Current password', attrs: { for: 'current-password' } }),
        input,
      ],
    }),
    confirmLabel: 'Change password',
    onConfirm: async () => {
      const value = input.value;
      if (!value) throw new Error('Enter your current password.');
      await onSubmit(value);
    },
  });
}

export async function init({ signal, session }) {
  const current = await needSession(session);
  if (!current) return;

  const form = qs('[data-profile-form]');
  if (!form) return;

  const profile = current.user?.profile ?? {};
  form.elements.full_name.value = profile.full_name ?? profile.display_name ?? '';
  form.elements.email.value = current.user?.email ?? '';
  // The e-mail address identifies the account and is verified; changing it is
  // a support task, so the field is shown but read-only.
  form.elements.email.readOnly = true;

  wireForm(form, async (values, { setStatus }) => {
    const fullName = values.full_name?.trim() ?? '';
    const newPassword = values.new_password ?? '';

    setStatus('Saving…');
    if (fullName && fullName !== (profile.full_name ?? profile.display_name ?? '')) {
      await api.patch('/me/profile', { full_name: fullName, display_name: fullName }, { signal });
    }

    if (newPassword) {
      await new Promise((resolve, reject) => {
        askForCurrentPassword(async (currentPassword) => {
          try {
            await api.post(
              '/auth/change-password',
              { current_password: currentPassword, new_password: newPassword },
              { signal },
            );
            resolve();
          } catch (error) {
            reject(error);
            throw error;
          }
        });
      });
    }

    form.elements.new_password.value = '';
    setStatus('Saved.', 'success');
    toastSuccess('Your profile has been updated.');
  });
}
