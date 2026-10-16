/**
 * Components — modal dialog.
 *
 * Built on `<dialog>` so focus trapping, `Esc` and the backdrop come from the
 * platform instead of hand-written key handlers. It is only ever used for
 * destructive confirmations; nothing essential lives behind a modal.
 */
import { el } from '../core/dom.js';

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string|Node} [options.body]
 * @param {string} [options.confirmLabel]
 * @param {'primary'|'danger'} [options.tone]
 * @param {() => void|Promise<void>} [options.onConfirm]
 */
export function openModal({ title, body, confirmLabel = 'Confirm', tone = 'primary', onConfirm }) {
  const dialog = el('dialog', {
    class: 'modal',
    children: [
      el('div', {
        class: 'modal__head',
        children: [el('h2', { class: 'card__title mb-0', text: title })],
      }),
      el('div', {
        class: 'modal__body',
        children: [typeof body === 'string' ? el('p', { text: body }) : body ?? el('p', { text: '' })],
      }),
      el('div', {
        class: 'modal__foot',
        children: [
          el('button', {
            class: 'btn',
            text: 'Cancel',
            attrs: { type: 'button', 'data-modal-cancel': '' },
          }),
          el('button', {
            class: `btn btn--${tone}`,
            text: confirmLabel,
            attrs: { type: 'button', 'data-modal-confirm': '' },
          }),
        ],
      }),
    ],
  });

  document.body.append(dialog);

  const close = () => {
    dialog.close();
    dialog.remove();
  };

  dialog.querySelector('[data-modal-cancel]').addEventListener('click', close);
  dialog.querySelector('[data-modal-confirm]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await onConfirm?.();
      close();
    } catch {
      // The caller reports the failure (toast); keep the dialog open so the
      // action can be retried without re-opening it.
      button.disabled = false;
    }
  });
  dialog.addEventListener('cancel', () => dialog.remove());

  dialog.showModal();
  return dialog;
}

/** `confirm()` with the app's own dialog; resolves to `true`/`false`. */
export function confirmAction(options) {
  return new Promise((resolve) => {
    let settled = false;
    const dialog = openModal({
      ...options,
      onConfirm: async () => {
        settled = true;
        await options.onConfirm?.();
        resolve(true);
      },
    });
    dialog.addEventListener('close', () => {
      if (!settled) resolve(false);
    });
  });
}
