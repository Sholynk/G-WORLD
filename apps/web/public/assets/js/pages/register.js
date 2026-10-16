/**
 * Page — create an account.
 *
 * Registrations are controlled by `ENABLE_REGISTRATION` on the API: if the
 * platform is closed to sign-ups the form says so instead of failing on submit.
 * Nothing here grants a role — new accounts are always plain students.
 */
import { api } from '../core/api.js';
import { el, qs, qsa } from '../core/dom.js';
import { renderCheckOptions, wireForm, wirePasswordToggles, wireStrengthMeter } from '../components/form.js';
import { toastSuccess } from '../components/toast.js';
import { pageError } from './_shared.js';

const INTERESTS = [
  { id: 'Technology', name: 'Technology and software' },
  { id: 'Business', name: 'Business and enterprise' },
  { id: 'Health', name: 'Health and care' },
  { id: 'Data', name: 'Data and analysis' },
  { id: 'Creative', name: 'Creative and design' },
  { id: 'Science', name: 'Science and engineering' },
];

export async function init({ signal } = {}) {
  wirePasswordToggles(document);

  const form = qs('[data-register-form]');
  const interestsHost = qs('[data-interests]');
  renderCheckOptions(interestsHost, INTERESTS, { name: 'interests[]' });

  wireStrengthMeter(qs('#password'), {
    meter: qs('[data-strength]'),
    label: qs('[data-strength-label]'),
  });

  // Ask the API whether registration is open; a closed platform hides the form.
  try {
    const meta = await api.get('/meta', { signal });
    if (meta.registration === false) {
      form.replaceChildren(
        el('p', { class: 'alert alert--warning', text: 'Registration is currently closed. Please try again later.' }),
      );
      return;
    }
  } catch (error) {
    // If /meta cannot be reached the submit will surface the real error.
    console.warn('[register] could not read /meta', error.message);
  }

  wireForm(form, async (values, { setStatus }) => {
    const payload = {
      email: values.email,
      password: values.password,
      accepted_terms: Boolean(values.accepted_terms),
      interests: qsa('input[name="interests[]"]:checked', form).map((input) => input.value),
    };
    if (values.display_name) payload.display_name = values.display_name;
    if (values.full_name) payload.full_name = values.full_name;
    if (values.education_level) payload.education_level = values.education_level;
    if (values.country) payload.country = values.country;

    setStatus('Creating your account…');
    const result = await api.post('/auth/register', payload);
    toastSuccess('Account created. Check your email to confirm it.', 'Almost there');
    setStatus('Account created — confirming your email…', 'success');

    // In local development the API returns the verification token so the flow
    // can be completed without a real inbox. Never present in production.
    if (result?.debug_verification_token) {
      window.location.assign(`/verify-email.html?token=${encodeURIComponent(result.debug_verification_token)}`);
      return;
    }
    window.location.assign(`/verify-email.html?email=${encodeURIComponent(payload.email)}`);
  });
}
