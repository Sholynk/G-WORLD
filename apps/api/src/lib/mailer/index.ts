/**
 * Sholynk Tech — email delivery.
 *
 * Two providers, selected by the `EMAIL_PROVIDER` variable:
 *
 *   console (default) — nothing leaves the platform. The message is stored in
 *     `email_messages` with status `logged` and the body is printed to the
 *     Worker log, so local development and tests can read verification and reset
 *     links directly. This is what makes the whole auth flow testable offline.
 *
 *   resend — a real HTTPS call to the provider API. Provider choice is
 *     deliberately isolated here: swapping in Postmark, MailChannels or SES means
 *     writing one more adapter, not touching any route.
 *
 * Delivery never blocks the user's request in a way that could break it: the
 * outbox row is written first, and a provider failure is recorded as
 * `status='failed'` for retry rather than surfaced as a 500.
 */
import type { Db } from '../../db/client.js';
import * as emailRepo from '../../db/repositories/email.js';
import type { AppConfig } from '../../env.js';
import type { Logger } from '../logger.js';
import type { EmailContent } from './templates.js';

export interface SendResult {
  queued: boolean;
  messageId: string;
  provider: 'console' | 'resend';
  delivered: boolean;
  error?: string;
}

export interface SendOptions {
  userId?: string | null;
  content: EmailContent;
}

async function sendViaResend(
  config: AppConfig,
  toEmail: string,
  content: EmailContent,
): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
  if (!config.email.apiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not configured' };
  }

  try {
    const response = await fetch(`${config.email.apiBaseUrl}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.email.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: config.email.from,
        to: [toEmail],
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: `provider responded ${response.status}: ${body.slice(0, 300)}` };
    }

    const payload = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, providerMessageId: payload?.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown email provider error' };
  }
}

/**
 * Sends an email and records the outcome. Never throws: the caller decides
 * whether a delivery failure should be visible to the user.
 */
export async function sendEmail(
  db: Db,
  config: AppConfig,
  logger: Logger,
  toEmail: string,
  options: SendOptions,
): Promise<SendResult> {
  const messageId = await emailRepo.queueEmail(db, {
    userId: options.userId ?? null,
    toEmail,
    subject: options.content.subject,
    bodyText: options.content.text,
    template: options.content.template,
    provider: config.email.provider,
  });

  if (config.email.provider === 'console') {
    await emailRepo.markSent(db, messageId, 'logged');
    logger.info('email logged (console provider)', {
      to: toEmail,
      subject: options.content.subject,
      template: options.content.template,
      preview: options.content.text.slice(0, 400),
    });
    return { queued: true, messageId, provider: 'console', delivered: true };
  }

  const result = await sendViaResend(config, toEmail, options.content);
  if (result.ok) {
    await emailRepo.markSent(db, messageId, 'sent', result.providerMessageId ?? null);
    logger.info('email sent', { to: toEmail, template: options.content.template });
    return { queued: true, messageId, provider: 'resend', delivered: true };
  }

  await emailRepo.markFailed(db, messageId, result.error ?? 'unknown error');
  logger.error('email delivery failed', {
    to: toEmail,
    template: options.content.template,
    error: result.error,
  });
  return { queued: true, messageId, provider: 'resend', delivered: false, error: result.error };
}

export { TEMPLATES } from './templates.js';
export type { EmailContent } from './templates.js';
