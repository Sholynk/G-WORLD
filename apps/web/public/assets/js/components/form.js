/**
 * Components — form plumbing.
 *
 * Every form in the app needs the same four things: stop the browser from
 * reloading the page, disable the button while the request is in flight, put a
 * message in one place, and map Zod's `error.issues[]` back onto the fields.
 * Doing it here keeps the page modules readable.
 */
import { clearFieldErrors, el, formValues, qs, qsa, showFieldErrors } from '../core/dom.js';
import { describeError } from '../core/errors.js';
import { setButtonLoading } from './loading.js';

/** Shows/hides a password input's reveal button. */
export function wirePasswordToggles(root = document) {
  for (const button of qsa('[data-toggle-password]', root)) {
    button.addEventListener('click', () => {
      const input = qs(`#${CSS.escape(button.getAttribute('aria-controls') ?? '')}`, root) ?? button.previousElementSibling;
      if (!input) return;
      const revealed = input.type === 'text';
      input.type = revealed ? 'password' : 'text';
      button.textContent = revealed ? 'Show' : 'Hide';
      button.setAttribute('aria-label', revealed ? 'Show password' : 'Hide password');
    });
  }
}

/**
 * Wires a form: `onSubmit(values, helpers)` is called with the parsed values and
 * may throw; thrown `ApiError`s with field errors mark the inputs.
 *
 * @param {HTMLFormElement} form
 * @param {(values: Record<string, any>, helpers: {setStatus: Function, setBusy: Function}) => Promise<void>} onSubmit
 */
export function wireForm(form, onSubmit) {
  const status = qs('[data-form-status], [role="status"]', form);
  const submitButton = qs('button[type="submit"]', form);

  const setStatus = (message, tone = '') => {
    if (!status) return;
    status.textContent = message ?? '';
    status.className = `form-status${tone ? ` form-status--${tone}` : ''}`;
  };

  const setBusy = (busy) => {
    if (submitButton) {
      setButtonLoading(submitButton, busy);
    }
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    setStatus('Working…');

    // Native validation first: it is faster and clearer than a round trip.
    if (!form.reportValidity()) {
      setStatus('Please correct the highlighted fields.', 'error');
      return;
    }

    setBusy(true);
    try {
      await onSubmit(formValues(form), { setStatus, setBusy });
    } catch (error) {
      const fieldErrors = error?.fieldErrors ?? {};
      if (Object.keys(fieldErrors).length > 0) showFieldErrors(form, fieldErrors);
      setStatus(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  });

  return { setStatus, setBusy };
}

/**
 * Client-side password strength hint. Deliberately advisory only — the API
 * enforces the real rules and is the authority on what is accepted.
 */
export function wireStrengthMeter(input, { meter, label } = {}) {
  if (!input || !meter) return;
  const bars = qsa('.strength__bar', meter);

  const score = (value) => {
    let points = 0;
    if (value.length >= 8) points += 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) points += 1;
    if (/\d/.test(value)) points += 1;
    if (/[^A-Za-z0-9]/.test(value) || value.length >= 14) points += 1;
    return points;
  };

  const update = () => {
    const value = input.value;
    meter.hidden = value.length === 0;
    const points = score(value);
    bars.forEach((bar, index) => bar.classList.toggle('strength__bar--on', index < points));
    if (label) {
      label.textContent = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][points] ?? 'Weak';
    }
  };

  input.addEventListener('input', update);
  update();
}

/** Toggles every checkbox in a group from a comma-separated model value. */
export function checkGroup(container, values = []) {
  const wanted = new Set(values);
  for (const input of qsa('input[type="checkbox"]', container)) {
    input.checked = wanted.has(input.value);
  }
}

/** Reads a checkbox group back into an array. */
export function readCheckGroup(container) {
  return qsa('input[type="checkbox"]', container)
    .filter((input) => input.checked)
    .map((input) => input.value);
}

/** Renders a checkbox group from a list of catalog rows. */
export function renderCheckOptions(container, options, { selected = [], name, max = null } = {}) {
  const chosen = new Set(selected);
  container.replaceChildren(
    ...options.map((option) =>
      el('label', {
        class: 'field-inline',
        children: [
          el('input', {
            attrs: {
              type: 'checkbox',
              name: name ?? 'options',
              value: option.id,
              ...(chosen.has(option.id) ? { checked: '' } : {}),
              ...(max ? { 'data-max-selected': String(max) } : {}),
            },
          }),
          el('span', { text: option.name ?? option.title ?? option.label ?? option.id }),
        ],
      }),
    ),
  );
  return container;
}
