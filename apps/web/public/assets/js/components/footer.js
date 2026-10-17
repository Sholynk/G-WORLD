/**
 * Components — public site footer.
 *
 * The footer is part of every public page's markup, so it is visible without
 * JavaScript. This module only fills in the support address from the runtime
 * configuration, so a deployment can change the contact e-mail without
 * touching 30 HTML files.
 */
import { config } from '../core/config.js';
import { qs, qsa } from '../core/dom.js';

export function mountFooter() {
  const host = qs('[data-site-footer]');
  if (!host) return null;

  for (const link of qsa('[data-footer-email]', host)) {
    link.textContent = config.supportEmail;
    link.setAttribute('href', `mailto:${config.supportEmail}`);
  }

  for (const link of qsa('[data-footer-site]', host)) link.textContent = config.siteName;

  return host;
}
