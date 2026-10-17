/**
 * Components — site header (and the session chip inside it).
 *
 * The header is rendered by JavaScript rather than duplicated in every HTML file:
 * one source of truth for navigation, one place that knows how to sign out.
 * Header markup is navigation chrome, not content, so pages keep their own
 * content in HTML for crawlers and no-JS visitors.
 */
import { config } from '../core/config.js';
import { el, qs } from '../core/dom.js';
import { initials } from '../core/format.js';
import { getSession, isAdmin, onSessionChange, signOut } from '../core/session.js';
import { toastError, toastSuccess } from './toast.js';

const PUBLIC_LINKS = [
  { href: '/index.html', label: 'Home' },
  { href: '/browse.html', label: 'Departments' },
  { href: '/courses.html', label: 'Courses' },
  { href: '/verify.html', label: 'Verify' },
];

const MEMBER_LINKS = [
  { href: '/dashboard.html', label: 'Dashboard' },
  { href: '/my-courses.html', label: 'My courses' },
  { href: '/certificates.html', label: 'Certificates' },
];

const ADMIN_LINKS = [{ href: '/admin/index.html', label: 'Admin' }];

function navList(links, currentPath) {
  return el('ul', {
    class: 'nav__list',
    children: links.map((link) =>
      el('li', {
        children: [
          el('a', {
            class: 'nav__link',
            text: link.label,
            attrs: {
              href: link.href,
              ...(currentPath === link.href ? { 'aria-current': 'page' } : {}),
            },
          }),
        ],
      }),
    ),
  });
}

function sessionChip(session) {
  if (!session?.user) {
    return el('div', {
      class: 'header__actions',
      children: [
        el('a', { class: 'btn btn--ghost', text: 'Sign in', attrs: { href: '/login.html' } }),
        el('a', { class: 'btn btn--primary', text: 'Create account', attrs: { href: '/register.html' } }),
      ],
    });
  }

  const name = session.user.profile?.display_name ?? session.user.email;
  return el('div', {
    class: 'header__actions',
    children: [
      el('a', {
        class: 'user-chip',
        attrs: { href: '/profile.html', title: 'Your profile' },
        children: [
          el('span', { class: 'user-chip__avatar', text: initials(name), attrs: { 'aria-hidden': 'true' } }),
          el('span', { class: 'user-chip__name', text: name }),
        ],
      }),
      el('button', {
        class: 'btn btn--ghost',
        text: 'Sign out',
        attrs: { type: 'button', 'data-action': 'sign-out' },
      }),
    ],
  });
}

/** Builds and inserts the header into `[data-site-header]`. */
export async function mountHeader() {
  const host = qs('[data-site-header]');
  if (!host) return null;

  const currentPath = window.location.pathname.endsWith('/') ? '/index.html' : window.location.pathname;
  const navHost = el('nav', { class: 'nav', attrs: { 'aria-label': 'Main navigation' } });
  let actionsHost = el('div', { class: 'header__actions' });

  const menuButton = el('button', {
    class: 'nav-toggle',
    attrs: {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'primary-navigation',
      'aria-label': 'Show navigation',
    },
    children: [
      el('span', { class: 'nav-toggle__bar' }),
      el('span', { class: 'nav-toggle__bar' }),
      el('span', { class: 'nav-toggle__bar' }),
    ],
  });
  navHost.id = 'primary-navigation';

  host.replaceChildren(
    el('div', {
      class: 'header__inner container',
      children: [
        el('a', {
          class: 'brand',
          attrs: { href: '/index.html' },
          children: [
            el('span', { class: 'brand__mark', text: 'GW', attrs: { 'aria-hidden': 'true' } }),
            el('span', { class: 'brand__text', children: [el('strong', { text: config.siteName })] }),
          ],
        }),
        navHost,
        actionsHost,
        menuButton,
      ],
    }),
  );

  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!open));
    navHost.classList.toggle('nav--open', !open);
  });

  const learnerPaths = ['/dashboard.html', '/my-courses.html', '/certificates.html', '/profile.html'];
  if (learnerPaths.includes(currentPath)) {
    const learnerLinks = [
      ['/dashboard.html', 'Dashboard'],
      ['/my-courses.html', 'My courses'],
      ['/certificates.html', 'Certificates'],
      ['/profile.html', 'Profile'],
    ];
    const learnerNav = el('aside', { class: 'workspace-sidebar' });
    const learnerList = el('ul', { class: 'list-plain' });
    learnerLinks.forEach(([href, label]) => {
      const link = el('a', {
        class: 'workspace-sidebar__link',
        text: label,
        attrs: { href, ...(currentPath === href ? { 'aria-current': 'page' } : {}) },
      });
      learnerList.append(el('li', { children: [link] }));
    });
    learnerNav.append(el('nav', { attrs: { 'aria-label': 'Learner sections' }, children: [learnerList] }));
    host.insertAdjacentElement('afterend', learnerNav);
  }

  function repaint(session) {
    const links = [
      ...PUBLIC_LINKS,
      ...(session ? MEMBER_LINKS : []),
      ...(isAdmin(session) ? ADMIN_LINKS : []),
    ];
    navHost.replaceChildren(navList(links, currentPath));
    const next = sessionChip(session);
    actionsHost.replaceWith(next);
    actionsHost = next;
  }

  // Paint the visitor state first so the header is usable while `/me` is in flight.
  repaint(null);

  host.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action="sign-out"]');
    if (!button) return;
    button.disabled = true;
    try {
      await signOut();
      toastSuccess('You are signed out.');
      repaint(null);
      window.location.assign('/index.html');
    } catch (error) {
      button.disabled = false;
      toastError(error?.message ?? 'Could not sign out.');
    }
  });

  onSessionChange(repaint);
  repaint(await getSession().catch(() => null));
  return host;
}
