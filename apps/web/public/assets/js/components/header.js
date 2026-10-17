/**
 * Components — public site header.
 *
 * The header markup itself lives in the HTML of every public page (so the
 * navigation is there even before JavaScript runs and for crawlers). This
 * module only *enhances* it:
 *
 *   1. it marks the current page in the navigation (`aria-current="page"`);
 *   2. it swaps the visitor links ("Log in", "Register") for the signed-in
 *      ones ("My learning", the learner's name) once the session is known;
 *   3. it closes the mobile "Menu" disclosure when the visitor clicks away
 *      from it or presses Escape.
 *
 * The layout is the one from the approved template: a white bar with a 1px
 * bottom border, the brand on the left, the links in the middle and the
 * account actions on the right. Below 768px the links and the register button
 * collapse into a "Menu" button.
 */
import { qs, qsa } from '../core/dom.js';
import { getSession, onSessionChange } from '../core/session.js';

const PUBLIC_LINKS = [
  { href: '/departments.html', label: 'Departments' },
  { href: '/subjects.html', label: 'Subjects' },
  { href: '/courses.html', label: 'Courses' },
];

/** Links that only exist for a signed-in learner. */
const LEARNER_LINKS = [{ href: '/dashboard.html', label: 'My learning' }];

/** The path the browser is on, without the extension. */
function currentPath() {
  const path = window.location.pathname.replace(/\/index\.html$/, '/');
  return path.length > 1 ? path.replace(/\/$/, '') : '/';
}

/** Marks the navigation entry that matches the current page. */
function markCurrentLink(root) {
  const path = currentPath();
  for (const link of qsa('.site-nav__link[href]', root)) {
    const href = link.getAttribute('href')?.split('?')[0] ?? '';
    const normalised = href.replace(/\/index\.html$/, '/');
    if (normalised === path) link.setAttribute('aria-current', 'page');
  }
}

/**
 * Paints the account actions for the current session state.
 * The same markup exists in the desktop bar and in the mobile "Menu" panel,
 * so both are updated together.
 */
function paintSession(root, session) {
  const signedIn = Boolean(session?.user);
  const name = session?.user?.profile?.display_name ?? session?.user?.email ?? '';

  for (const node of qsa('[data-nav-login]', root)) node.hidden = signedIn;
  for (const node of qsa('[data-nav-register]', root)) node.hidden = signedIn;
  for (const node of qsa('[data-nav-session]', root)) node.hidden = !signedIn;
  for (const node of qsa('[data-nav-name]', root)) node.textContent = name;
  for (const node of qsa('[data-nav-learning]', root)) {
    node.hidden = !signedIn;
    node.setAttribute('href', LEARNER_LINKS[0].href);
  }
}

/** Closes the mobile disclosure when the visitor clicks outside it. */
function wireMenu(root) {
  const menu = qs('.site-nav__menu', root);
  if (!menu) return;

  document.addEventListener('click', (event) => {
    if (!menu.open) return;
    if (menu.contains(event.target)) return;
    menu.open = false;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      qs('summary', menu)?.focus();
    }
  });
}

/**
 * Enhances the header of the current page.
 * @returns {HTMLElement|null} the header element
 */
export async function mountHeader() {
  const host = qs('[data-site-header]');
  if (!host) return null;

  markCurrentLink(host);
  wireMenu(host);

  const paint = (session) => paintSession(host, session);
  paint(null);
  onSessionChange(paint);
  paint(await getSession().catch(() => null));

  return host;
}

/** Exported for the tests: the links the public navigation is built from. */
export const publicNavLinks = PUBLIC_LINKS;
