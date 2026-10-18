/**
 * Repository — the email outbox.
 *
 * Every outbound message is written to `email_messages` *before* it is sent:
 *
 *   1. row inserted with status `queued`
 *   2. provider called
 *   3. row updated to `sent` or `failed` (with the provider error)
 *
 * With `EMAIL_PROVIDER=console` (the development default) the status becomes
 * `logged` and the message body is printed to the Worker log, which makes the
 * verification and reset flows fully testable without any email provider.
 */
import type { Db } from '../client.js';
import type { EmailStatus } from '@sholynk/shared';
import { newId, ID_PREFIXES } from '../../lib/ids.js';

export interface EmailMessageRow {
  id: string;
  user_id: string | null;
  to_email: string;
  subject: string;
  body_text: string;
  template: string | null;
  provider: string;
  status: EmailStatus;
  error: string | null;
  attempts: number;
  provider_message_id: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueueEmailInput {
  userId?: string | null;
  toEmail: string;
  subject: string;
  bodyText: string;
  template?: string | null;
  provider: 'console' | 'resend';
}

export async function queueEmail(db: Db, input: QueueEmailInput): Promise<string> {
  const id = newId(ID_PREFIXES.emailMessage);
  await db.run(
    `INSERT INTO email_messages (id, user_id, to_email, subject, body_text, template, provider, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')`,
    [
      id,
      input.userId ?? null,
      input.toEmail,
      input.subject.slice(0, 200),
      input.bodyText,
      input.template ?? null,
      input.provider,
    ],
  );
  return id;
}

export async function markSent(
  db: Db,
  id: string,
  status: 'sent' | 'logged',
  providerMessageId?: string | null,
): Promise<number> {
  const now = new Date().toISOString();
  return db.changes(
    `UPDATE email_messages
        SET status = ?, provider_message_id = ?, sent_at = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ?`,
    [status, providerMessageId ?? null, now, now, id],
  );
}

export async function markFailed(db: Db, id: string, error: string): Promise<number> {
  const now = new Date().toISOString();
  return db.changes(
    `UPDATE email_messages
        SET status = 'failed', error = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ?`,
    [error.slice(0, 500), now, id],
  );
}

export interface ListEmailFilters {
  status?: EmailStatus;
  toEmail?: string;
  page: number;
  perPage: number;
}

export async function listEmails(
  db: Db,
  filters: ListEmailFilters,
): Promise<{ items: EmailMessageRow[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filters.status) {
    conditions.push(`status = ?`);
    params.push(filters.status);
  }
  if (filters.toEmail) {
    conditions.push(`to_email LIKE ? COLLATE NOCASE`);
    params.push(`%${filters.toEmail}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = await db.count(`SELECT COUNT(*) AS total FROM email_messages ${where}`, params);
  const items = await db.all<EmailMessageRow>(
    `SELECT id, user_id, to_email, subject, body_text, template, provider, status, error, attempts,
            provider_message_id, sent_at, created_at, updated_at
       FROM email_messages ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.perPage, (filters.page - 1) * filters.perPage],
  );
  return { items, total };
}

/** Latest message of a template for a user — used by tests and by "resend". */
export async function findLatestForUser(
  db: Db,
  userId: string,
  template: string,
): Promise<EmailMessageRow | null> {
  return db.first<EmailMessageRow>(
    `SELECT id, user_id, to_email, subject, body_text, template, provider, status, error, attempts,
            provider_message_id, sent_at, created_at, updated_at
       FROM email_messages
      WHERE user_id = ? AND template = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, template],
  );
}

export async function countFailedEmails(db: Db): Promise<number> {
  return db.count(`SELECT COUNT(*) AS total FROM email_messages WHERE status = 'failed'`);
}
