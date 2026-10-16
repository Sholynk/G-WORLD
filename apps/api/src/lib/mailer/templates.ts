/**
 * G WORLD — transactional email templates.
 *
 * Plain text with a small HTML wrapper: teaches nothing to spam filters,
 * renders everywhere, and keeps the outbox row human-readable in the admin
 * dashboard. Every template returns `{ subject, text, html }` so the provider
 * adapter can send either or both.
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
  supportEmail?: string;
}

const DEFAULT_BRANDING: SiteBranding = {
  siteName: 'G WORLD',
  appBaseUrl: 'http://localhost:5173',
  supportEmail: 'support@gworld.example',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

function wrapHtml(branding: SiteBranding, heading: string, bodyHtml: string, footerNote?: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:24px;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <p style="margin:0 0 24px;font-size:18px;font-weight:700;letter-spacing:0.02em;">${escapeHtml(branding.siteName)}</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${escapeHtml(heading)}</h1>
      ${bodyHtml}
      <hr style="margin:32px 0 16px;border:none;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;color:#6b7280;">
        ${escapeHtml(footerNote ?? `You are receiving this email because an account was created at ${branding.siteName}.`)}
      </p>
      <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">
        Need help? Contact ${escapeHtml(branding.supportEmail ?? 'support@gworld.example')}.
      </p>
    </div>
  </body>
</html>`;
}

function button(branding: SiteBranding, url: string, label: string): string {
  return `<p style="margin:24px 0;">
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#1f4fd8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">${escapeHtml(label)}</a>
  </p>`;
}

export function verificationEmail(input: {
  toEmail: string;
  displayName?: string | null;
  token: string;
  branding?: Partial<SiteBranding>;
}): EmailContent {
  const branding = { ...DEFAULT_BRANDING, ...input.branding };
  const url = `${branding.appBaseUrl.replace(/\/+$/, '')}/verify-email.html?token=${encodeURIComponent(input.token)}`;
  const greeting = input.displayName ? `Hi ${input.displayName},` : 'Hi,';
  const text = `${greeting}

Welcome to ${branding.siteName}. Confirm your email address to activate your account:

${url}

This link expires in 48 hours and can be used once. If you did not create an account, ignore this email.

— ${branding.siteName}`;

  return {
    subject: `Confirm your ${branding.siteName} email address`,
    text,
    html: wrapHtml(
      branding,
      'Confirm your email address',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Welcome to ${escapeHtml(branding.siteName)}. Confirm your email address to activate your account and start learning.</p>
       ${button(branding, url, 'Confirm email address')}
       <p style="margin:0;font-size:13px;color:#6b7280;">This link expires in 48 hours and can be used once.</p>`,
    ),
    template: 'email_verification',
  };
}

export function passwordResetEmail(input: {
  toEmail: string;
  displayName?: string | null;
  token: string;
  branding?: Partial<SiteBranding>;
}): EmailContent {
  const branding = { ...DEFAULT_BRANDING, ...input.branding };
  const url = `${branding.appBaseUrl.replace(/\/+$/, '')}/reset-password.html?token=${encodeURIComponent(input.token)}`;
  const greeting = input.displayName ? `Hi ${input.displayName},` : 'Hi,';
  const text = `${greeting}

We received a request to reset your ${branding.siteName} password:

${url}

This link expires in 1 hour and can be used once. If you did not request it, no action is needed — your password stays unchanged.

— ${branding.siteName}`;

  return {
    subject: `Reset your ${branding.siteName} password`,
    text,
    html: wrapHtml(
      branding,
      'Reset your password',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">We received a request to reset your password. Choose a new one using the button below.</p>
       ${button(branding, url, 'Choose a new password')}
       <p style="margin:0;font-size:13px;color:#6b7280;">This link expires in 1 hour and can be used once. If you did not request it, you can safely ignore this email.</p>`,
      'If you did not request a password reset, your password remains unchanged.',
    ),
    template: 'password_reset',
  };
}

export function welcomeEmail(input: {
  toEmail: string;
  displayName?: string | null;
  studentNumber?: string | null;
  branding?: Partial<SiteBranding>;
}): EmailContent {
  const branding = { ...DEFAULT_BRANDING, ...input.branding };
  const dashboard = `${branding.appBaseUrl.replace(/\/+$/, '')}/dashboard.html`;
  const greeting = input.displayName ? `Hi ${input.displayName},` : 'Hi,';
  const numberLine = input.studentNumber
    ? `Your student number is ${input.studentNumber}. Keep it handy — it appears on your G WORLD identity card.`
    : 'Your student number will appear on your dashboard.';

  return {
    subject: `Your ${branding.siteName} account is ready`,
    text: `${greeting}

Your email is confirmed and your account is active.

${numberLine}

Open your dashboard to browse departments and enrol in your first course:
${dashboard}

— ${branding.siteName}`,
    html: wrapHtml(
      branding,
      'Your account is ready',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Your email is confirmed and your account is active.</p>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escapeHtml(numberLine)}</p>
       ${button(branding, dashboard, 'Open your dashboard')}`,
    ),
    template: 'welcome',
  };
}

export function certificateIssuedEmail(input: {
  toEmail: string;
  displayName?: string | null;
  courseTitle: string;
  certificateNumber: string;
  verificationCode: string;
  branding?: Partial<SiteBranding>;
}): EmailContent {
  const branding = { ...DEFAULT_BRANDING, ...input.branding };
  const url = `${branding.appBaseUrl.replace(/\/+$/, '')}/verify.html?code=${encodeURIComponent(input.verificationCode)}`;
  const greeting = input.displayName ? `Hi ${input.displayName},` : 'Hi,';

  return {
    subject: `Your certificate for ${input.courseTitle}`,
    text: `${greeting}

Congratulations — you completed "${input.courseTitle}" and your certificate has been issued.

Certificate number: ${input.certificateNumber}
Verification code: ${input.verificationCode}
Verify or share it here: ${url}

— ${branding.siteName}`,
    html: wrapHtml(
      branding,
      'Certificate issued',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Congratulations — you completed <strong>${escapeHtml(input.courseTitle)}</strong> and your certificate has been issued.</p>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Certificate number: <strong>${escapeHtml(input.certificateNumber)}</strong><br>Verification code: <strong>${escapeHtml(input.verificationCode)}</strong></p>
       ${button(branding, url, 'View and verify certificate')}`,
    ),
    template: 'certificate_issued',
  };
}

export function assignmentGradedEmail(input: {
  toEmail: string;
  displayName?: string | null;
  assignmentTitle: string;
  scorePoints: number;
  maxPoints: number;
  feedback?: string | null;
  branding?: Partial<SiteBranding>;
}): EmailContent {
  const branding = { ...DEFAULT_BRANDING, ...input.branding };
  const greeting = input.displayName ? `Hi ${input.displayName},` : 'Hi,';
  const percent = input.maxPoints > 0 ? Math.round((input.scorePoints / input.maxPoints) * 100) : 0;
  const feedbackLine = input.feedback ? `\nFeedback: ${input.feedback}\n` : '';

  return {
    subject: `Your submission for ${input.assignmentTitle} has been graded`,
    text: `${greeting}

Your submission for "${input.assignmentTitle}" has been graded.

Score: ${input.scorePoints} / ${input.maxPoints} (${percent}%)
${feedbackLine}
— ${branding.siteName}`,
    html: wrapHtml(
      branding,
      'Submission graded',
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Your submission for <strong>${escapeHtml(input.assignmentTitle)}</strong> has been graded.</p>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Score: <strong>${input.scorePoints} / ${input.maxPoints} (${percent}%)</strong></p>
       ${input.feedback ? `<p style="margin:0;font-size:15px;line-height:1.6;"><strong>Feedback:</strong> ${escapeHtml(input.feedback)}</p>` : ''}`,
    ),
    template: 'assignment_graded',
  };
}

export const TEMPLATES = {
  verificationEmail,
  passwordResetEmail,
  welcomeEmail,
  certificateIssuedEmail,
  assignmentGradedEmail,
} as const;
