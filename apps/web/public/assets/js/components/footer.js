/**
 * Components — site footer.
 *
 * Content-only, rendered by JavaScript. The footer repeats the catalog links so
 * a crawler that does not run scripts still reaches the catalog from the pages
 * that ship real HTML (`index.html`, `courses.html`, `browse.html`).
 */
import { config } from '../core/config.js';
import { el, qs } from '../core/dom.js';

const COLUMNS = [
  {
    heading: 'Learn',
    links: [
      { href: '/courses.html', label: 'All courses' },
      { href: '/browse.html', label: 'Departments' },
      { href: '/search.html', label: 'Search' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { href: '/dashboard.html', label: 'Dashboard' },
      { href: '/my-courses.html', label: 'My courses' },
      { href: '/certificates.html', label: 'Certificates' },
      { href: '/settings.html', label: 'Settings' },
    ],
  },
  {
    heading: 'Trust',
    links: [
      { href: '/verify.html', label: 'Verify a certificate' },
      { href: '/settings.html#qr', label: 'Your QR identity' },
    ],
  },
];

export function mountFooter() {
  const host = qs('[data-site-footer]');
  if (!host) return null;

  host.replaceChildren(
    el('div', {
      class: 'container footer__inner',
      children: [
        el('div', {
          class: 'footer__brand',
          children: [
            el('p', { class: 'brand__text', children: [el('strong', { text: config.siteName })] }),
            el('p', { class: 'muted', text: config.tagline }),
            el('p', {
              class: 'muted',
              children: [
                el('a', { text: config.supportEmail, attrs: { href: `mailto:${config.supportEmail}` } }),
              ],
            }),
          ],
        }),
        ...COLUMNS.map((column) =>
          el('nav', {
            class: 'footer__column',
            attrs: { 'aria-label': column.heading },
            children: [
              el('h2', { class: 'footer__heading', text: column.heading }),
              el('ul', {
                class: 'footer__links',
                children: column.links.map((link) =>
                  el('li', { children: [el('a', { text: link.label, attrs: { href: link.href } })] }),
                ),
              }),
            ],
          }),
        ),
      ],
    }),
    el('p', {
      class: 'footer__legal container',
      text: `© ${new Date().getFullYear()} ${config.siteName}. Built on Cloudflare Workers, D1 and Pages.`,
    }),
  );
  return host;
}
