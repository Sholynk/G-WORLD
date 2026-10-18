/**
 * Sholynk Tech — transactional email templates.
 *
 * Pure functions: input object in, `{ subject, text, html, template }` out. No
 * I/O, no environment reads — the caller (routes/auth.ts, the editorial
 * notification service) supplies branding and URLs, which keeps the templates
 * unit-testable and the provider layer dumb.
 */

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
  template: string;
}

export interface SiteBranding {
  siteName: string;
  appBaseUrl: string;
}

const DEFAULT_BRANDING: SiteBranding = {
  siteName: 'Sholynk Tech',
  appBaseUrl: 'http://localhost:5173',
};

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapHtml(branding: SiteBranding, heading: string, bodyHtml: string, footerNote?: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f7f9f9;font-family:Arial,Helvetica,sans-serif;color:#0f1419;">
    <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
      <div style="background:#000000;border-radius:12px 12px 0 0;padding:18px 24px;">
        <span style="color:#ffffff;font-weight:700;font-size:18px;letter-spacing:0.02em;">${escapeHtml(branding.siteName)}</span>
      </div>
      <div style="background:#ffffff;border:1px solid rgba(29,155,240,0.16);border-top:none;border-radius:0 0 12px 12px;padding:24px;">
        <h1 style="margin:0 0 12px;font-size:20px;color:#0f1419;">${escapeHtml(heading)}</h1>
        ${bodyHtml}
        ${footerNote ? `<p style="margin-top:20px;color:#536471;font-size:12px;">${escapeHtml(footerNote)}</p>` : ''}
      </div>
      <p style="color:#536471;font-size:12px;text-align:center;margin-top:16px;">
        &copy; ${new Date().getFullYear()} ${escapeHtml(branding.siteName)}
      </p>
    </div>
  </body>
</html>`;
}

function button(branding: SiteBranding, url: string, label: string): string {
  return `<p style="margin:20px 0;">
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#1d9bf0;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;">${escapeHtml(label)}</a>
  </p>`;
}

export function verificationEmail(input: {
  toEmail: string;
  displayName?: string | null;
  token: string;
  branding?: Partial<SiteBranding>;
}): EmailContent {
  const branding = { ...DEFAULT_BRANDING, ...input.branding };
  const url = `${branding.appBaseUrl.replace(/\/+$/, '')}/reset.html?verify=${encodeURIComponent(input.token)}`;
  const greeting = input.displayName ? `Hi ${input.displayName},` : 'Hi,';
  const text = `${greeting}

Confirm your email address to activate your ${branding.siteName} account.

Open this link to verify (it expires in 48 hours):
${url}

If you did not create an account, you can ignore this message.`;

  const html = wrapHtml(
    branding,
    'Confirm your email',
    `<p style="color:#536471;">${escapeHtml(greeting)} thanks for joining ${escapeHtml(branding.siteName)}. Confirm your email address to activate your account.</p>
     ${button(branding, url, 'Verify email address')}
     <p style="color:#536471;font-size:13px;">This link expires in 48 hours. If you did not create an account, you can ignore this message.</p>`,
    'You received this email because an account was created with your address.',
  );

  return { subject: `Confirm your ${branding.siteName} email`, text, html, template: 'verification' };
}

export function passwordResetEmail(input: {
  toEmail: string;
  displayName?: string | null;
  token: string;
  branding?: Partial<SiteBranding>;
}): EmailContent {
  const branding = { ...DEFAULT_BRANDING, ...input.branding };
  const url = `${branding.appBaseUrl.replace(/\/+$/, '')}/reset.html?token=${encodeURIComponent(input.token)}`;
  const greeting = input.displayName ? `Hi ${input.displayName},` : 'Hi,';
  const text = `${greeting}

We received a request to reset your ${branding.siteName} password.

Choose a new password within the next hour:
${url}

If you did not request this, you can safely ignore this email — your password stays unchanged.`;

  const html = wrapHtml(
    branding,
    'Reset your password',
    `<p style="color:#536471;">${escapeHtml(greeting)} we received a request to reset your password. This link is valid for one hour and can be used once.</p>
     ${button(branding, url, 'Choose a new password')}
     <p style="color:#536471;font-size:13px;">If you did not request this, you can safely ignore this email.</p>`,
    'For your security, never share this link with anyone.',
  );

  return { subject: `Reset your ${branding.siteName} password`, text, html, template: 'password_reset' };
}

export function welcomeEmail(input: {
  toEmail: string;
  displayName?: string | null;
  branding?: Partial<SiteBranding>;
}): EmailContent {
  const branding = { ...DEFAULT_BRANDING, ...input.branding };
  const home = `${branding.appBaseUrl.replace(/\/+$/, '')}/`;
  const greeting = input.displayName ? `Hi ${input.displayName},` : 'Hi,';
  const text = `${greeting}

Your ${branding.siteName} account is ready.

Read the latest stories: ${home}
Editorial dashboard: ${branding.appBaseUrl.replace(/\/+$/, '')}/admin/

— The ${branding.siteName} team`;

  const html = wrapHtml(
    branding,
    'Your account is ready',
    `<p style="color:#536471;">${escapeHtml(greeting)} your email is confirmed and your ${escapeHtml(branding.siteName)} account is active.</p>
     ${button(branding, home, 'Read the latest stories')}`,
    'You received this email because your address was verified on Sholynk Tech.',
  );

  return { subject: `Welcome to ${branding.siteName}`, text, html, template: 'welcome' };
}

/* -------------------------------------------------------------------------- */
/* Editorial review notification (ported from the legacy CMS notifications.js)  */
/* -------------------------------------------------------------------------- */

export interface ReviewArticleSummary {
  title: string;
  slug: string;
  author: string;
  authorSlug?: string;
  category: string;
  subcategory?: string;
  status: string;
  description?: string;
  body?: string;
  tags?: string[];
  submitterEmail?: string;
}

/**
 * "A new article has been submitted for review" — sent to EDITOR_EMAIL whenever
 * an article enters the `pending` state. Text and HTML mirror the legacy
 * notification so the editorial inbox reads the same as before.
 */
export function reviewSubmissionEmail(input: {
  article: ReviewArticleSummary;
  editorEmail: string;
  branding?: Partial<SiteBranding>;
}): EmailContent {
  const branding = { ...DEFAULT_BRANDING, ...input.branding };
  const base = branding.appBaseUrl.replace(/\/+$/, '');
  const article = input.article;
  const adminUrl = `${base}/admin/`;
  const previewPath = `/articles/${encodeURIComponent(article.slug)}/`;
  const previewUrl = `${base}${previewPath}`;
  const wordCount = String(article.body ?? '').split(/\s+/).filter(Boolean).length;

  const text = [
    'A new article has been submitted for review on Sholynk Tech.',
    '',
    `Title:        ${article.title}`,
    `Author:       ${article.author}${article.authorSlug ? ` (${article.authorSlug})` : ''}`,
    `Category:     ${article.category}${article.subcategory ? ` / ${article.subcategory}` : ''}`,
    `Status:       ${article.status}`,
    `Slug:         ${article.slug}`,
    `Submitter:    ${article.submitterEmail || '(not provided)'}`,
    `Word count:   ~${wordCount} words`,
    `Tags:         ${(article.tags ?? []).join(', ') || '(none)'}`,
    '',
    'Description:',
    article.description || '(no description provided)',
    '',
    `Open admin dashboard: ${adminUrl}`,
    `Preview article:      ${previewUrl}`,
    '',
    'This message was generated automatically by the Sholynk CMS.',
  ].join('\n');

  const esc = escapeHtml;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#101828;max-width:640px;margin:0 auto;">
    <h1 style="color:#1d9bf0;">New article submitted for review</h1>
    <p><strong>${esc(article.title)}</strong></p>
    <table style="border-collapse:collapse;margin:1rem 0;font-size:0.9rem;">
      <tr><td style="padding:0.3rem 1rem 0.3rem 0;color:#667085;">Author</td><td>${esc(article.author)}</td></tr>
      <tr><td style="padding:0.3rem 1rem 0.3rem 0;color:#667085;">Category</td><td>${esc(article.category)}${article.subcategory ? ` / ${esc(article.subcategory)}` : ''}</td></tr>
      <tr><td style="padding:0.3rem 1rem 0.3rem 0;color:#667085;">Slug</td><td>${esc(article.slug)}</td></tr>
      <tr><td style="padding:0.3rem 1rem 0.3rem 0;color:#667085;">Submitter</td><td>${esc(article.submitterEmail || '(not provided)')}</td></tr>
      <tr><td style="padding:0.3rem 1rem 0.3rem 0;color:#667085;">Tags</td><td>${esc((article.tags ?? []).join(', ') || '(none)')}</td></tr>
    </table>
    <p style="color:#344054;">${esc(article.description || 'No description provided.')}</p>
    <p>
      <a href="${esc(adminUrl)}" style="display:inline-block;padding:0.7rem 1.1rem;background:#1d9bf0;color:#fff;border-radius:0.5rem;text-decoration:none;margin-right:0.6rem;">Open CMS admin</a>
      <a href="${esc(previewUrl)}" style="display:inline-block;padding:0.7rem 1.1rem;border:1px solid #dfe5ec;color:#1d9bf0;border-radius:0.5rem;text-decoration:none;">Preview article</a>
    </p>
    <p style="color:#98a2b3;font-size:0.75rem;">Automated message from the Sholynk CMS.</p>
  </body></html>`;

  return {
    subject: `[Sholynk Review] ${article.title}`.replace(/[\r\n]+/g, ' ').slice(0, 900),
    text,
    html,
    template: 'review_submission',
  };
}

export const TEMPLATES = {
  verificationEmail,
  passwordResetEmail,
  welcomeEmail,
  reviewSubmissionEmail,
};
