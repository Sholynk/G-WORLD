/**
 * Core — page bootstrap.
 *
 * Every page ends with the same three lines:
 *
 *   <script type="module">
 *     import { boot } from './assets/js/core/boot.js';
 *     import { init } from './assets/js/pages/courses.js';
 *     boot(init);
 *   </script>
 *
 * `boot` does the four things each page would otherwise repeat, in an order that
 * guarantees the header and footer exist before page code runs:
 *   1. mount the shared header and footer;
 *   2. label the page for assistive technology (`<main>` gets a heading);
 *   3. run the page's `init({ signal })`;
 *   4. turn any escaping error into a visible message instead of a silent blank
 *      page, and log it with the API request id when the error came from the API.
 *
 * It never swallows an error silently — a broken page in development must say so.
 */
import { getSession, signOut } from './session.js';
import { describeError } from './errors.js';
import { qs, qsa } from './dom.js';
import { toastSuccess } from '../components/toast.js';

/** @typedef {(context: { signal: AbortSignal, session: object|null }) => void|Promise<void>} PageInit */

/**
 * Fills the chrome that depends on the session: the learner's name in the
 * application top bar and the sign-out button.
 */
function paintSessionChrome(session) {
  const name =
    session?.user?.profile?.display_name ?? session?.user?.profile?.full_name ?? session?.user?.email ?? '';

  for (const node of qsa('[data-session-name]')) node.textContent = name;
  for (const node of qsa('[data-session-email]')) node.textContent = session?.user?.email ?? '';
}

export async function boot(init, options = {}) {
  const header = await import('../components/header.js');
  const footer = await import('../components/footer.js');

  await header.mountHeader().catch((error) => console.error('[boot] header failed', error));
  footer.mountFooter();

  const main = qs('main');
  if (main && !main.hasAttribute('aria-labelledby')) {
    const heading = main.querySelector('h1');
    if (heading) {
      if (!heading.id) heading.id = 'page-title';
      main.setAttribute('aria-labelledby', heading.id);
    }
  }

  // A single abort signal per page: components can cancel in-flight requests
  // when the user navigates away, and nothing keeps running after unload.
  const controller = new AbortController();
  window.addEventListener('pagehide', () => controller.abort(), { once: true });

  // Signing out is a chrome action, so it is wired once, here.
  for (const button of qsa('[data-sign-out]')) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await signOut();
        toastSuccess('You are signed out.');
        window.location.assign('/index.html');
      } catch (error) {
        button.disabled = false;
        console.error('[boot] sign out failed', error);
      }
    });
  }

  try {
    const session = options.session ?? (await getSession().catch(() => null));
    paintSessionChrome(session);
    await init?.({ signal: controller.signal, session });
  } catch (error) {
    console.error('[boot] page init failed', error);
    const target = qs(options.errorTarget ?? '[data-page-error]') ?? main;
    if (target) {
      const box = document.createElement('div');
      box.className = 'empty-state empty-state--error';
      box.setAttribute('role', 'alert');
      const title = document.createElement('h2');
      title.className = 'empty-state__title';
      title.textContent = 'This page could not finish loading';
      const message = document.createElement('p');
      message.className = 'empty-state__message';
      message.textContent = describeError(error);
      box.append(title, message);
      if (error?.requestId) {
        const detail = document.createElement('p');
        detail.className = 'muted mono';
        detail.textContent = `Request ${error.requestId}`;
        box.append(detail);
      }
      target.prepend(box);
    }
  }
}

/** Marks the document as ready, which the CSS uses to reveal progressive content. */
export function markReady() {
  document.documentElement.dataset.ready = 'true';
}
