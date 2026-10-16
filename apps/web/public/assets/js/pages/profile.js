/**
 * Page — profile.
 *
 * `PATCH /me/profile` accepts a subset of the profile; the page loads the
 * current values from `/me` and sends only what changed, so an older saved form
 * cannot silently reset a field someone else updated.
 */
import { api } from '../core/api.js';
import { qs, qsa } from '../core/dom.js';
import { formatDate, humanize } from '../core/format.js';
import { renderCheckOptions, readCheckGroup, wireForm } from '../components/form.js';
import { toastSuccess } from '../components/toast.js';
import { fill, needSession, pageError } from './_shared.js';

const INTEREST_OPTIONS = [
  { id: 'Technology', name: 'Technology and software' },
  { id: 'Business', name: 'Business and enterprise' },
  { id: 'Health', name: 'Health and care' },
  { id: 'Data', name: 'Data and analysis' },
  { id: 'Creative', name: 'Creative and design' },
  { id: 'Science', name: 'Science and engineering' },
];

export async function init({ signal, session }) {
  const current = await needSession(session);
  if (!current) return;

  const form = qs('[data-profile-form]');
  const interestsHost = qs('[data-profile-interests]');
  const user = current.user;
  const profile = user.profile ?? {};

  fill('[data-profile-summary]', `${user.email} · ${user.role}${user.student_number ? ` · ${user.student_number}` : ''}`);
  if (profile.member_since ?? user.created_at) {
    qs('[data-profile-summary]').textContent += ` · joined ${formatDate(profile.member_since ?? user.created_at)}`;
  }

  form.elements.display_name.value = profile.display_name ?? '';
  form.elements.full_name.value = profile.full_name ?? '';
  form.elements.education_level.value = profile.education_level ?? '';
  form.elements.country.value = profile.country ?? '';
  form.elements.timezone.value = profile.timezone ?? '';
  form.elements.goals.value = profile.goals ?? '';
  form.elements.bio.value = profile.bio ?? '';

  renderCheckOptions(interestsHost, INTEREST_OPTIONS, {
    name: 'interests[]',
    selected: profile.interests ?? [],
  });
  fill('[data-profile-goals-hint]', '');

  wireForm(form, async (values, { setStatus }) => {
    const payload = {
      display_name: values.display_name,
      full_name: values.full_name || null,
      education_level: values.education_level || null,
      country: values.country || null,
      timezone: values.timezone || null,
      goals: values.goals || null,
      bio: values.bio || null,
      interests: readCheckGroup(interestsHost),
    };

    setStatus('Saving…');
    await api.patch('/me/profile', payload, { signal });
    setStatus('Saved.', 'success');
    toastSuccess('Profile updated.');
  });
}
