/**
 * Repository — public forms: newsletter subscriptions and contact messages.
 *
 * Ported from the legacy CMS module (cms/lib/forms.js). Both forms write to the
 * same database as the CMS, so they work on any deployment with a durable D1
 * binding. The hidden honeypot check lives in the route layer (the schema
 * carries the trap fields); everything here is persistence.
 */
import type { Db } from '../client.js';
import { badRequest } from '../../lib/errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}

export interface SubscriberDto {
  id: number;
  name: string;
  email: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactMessageDto {
  id: number;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
}

/** Subscribe (or re-activate) an email address. Case-insensitively unique. */
export async function subscribe(db: Db, payload: { name?: string; email?: string }): Promise<{ accepted: true }> {
  const name = clean(payload.name, 120);
  const email = clean(payload.email, 254).toLowerCase();
  if (!name) throw badRequest('Name is required');
  if (!validEmail(email)) throw badRequest('A valid email address is required');

  await db.run(
    `INSERT INTO newsletter_subscribers (name, email)
     VALUES (?, ?)
     ON CONFLICT(email) DO UPDATE SET
       name = excluded.name,
       status = 'active',
       updated_at = datetime('now')`,
    [name, email],
  );
  return { accepted: true };
}

export async function addContactMessage(
  db: Db,
  payload: { name?: string; email?: string; subject?: string; message?: string },
): Promise<{ accepted: true; id: number }> {
  const name = clean(payload.name, 120);
  const email = clean(payload.email, 254).toLowerCase();
  const subject = clean(payload.subject, 200);
  const message = clean(payload.message, 5000);
  if (!name) throw badRequest('Name is required');
  if (!validEmail(email)) throw badRequest('A valid email address is required');
  if (!subject) throw badRequest('Subject is required');
  if (message.length < 10) throw badRequest('Message must be at least 10 characters');

  const result = await db.run(
    'INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)',
    [name, email, subject, message],
  );
  return { accepted: true, id: Number(result.lastRowId ?? 0) };
}

/** One page of subscribers, newest first. The inbox is never loaded in full. */
export async function listSubscribers(db: Db, limit = 50, offset = 0): Promise<SubscriberDto[]> {
  const rows = await db.all<Record<string, string | number>>(
    `SELECT id, name, email, status, created_at AS createdAt, updated_at AS updatedAt
     FROM newsletter_subscribers ORDER BY id DESC LIMIT ? OFFSET ?`,
    [Number(limit), Number(offset)],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ''),
    email: String(row.email ?? ''),
    status: String(row.status ?? 'active'),
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
  }));
}

export async function countSubscribers(db: Db): Promise<number> {
  return db.count('SELECT COUNT(*) AS total FROM newsletter_subscribers');
}

/** One page of contact messages, newest first. */
export async function listContactMessages(db: Db, limit = 50, offset = 0): Promise<ContactMessageDto[]> {
  const rows = await db.all<Record<string, string | number>>(
    `SELECT id, name, email, subject, message, status, created_at AS createdAt
     FROM contact_messages ORDER BY id DESC LIMIT ? OFFSET ?`,
    [Number(limit), Number(offset)],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ''),
    email: String(row.email ?? ''),
    subject: String(row.subject ?? ''),
    message: String(row.message ?? ''),
    status: String(row.status ?? 'new'),
    createdAt: String(row.createdAt ?? ''),
  }));
}

export async function countContactMessages(db: Db): Promise<number> {
  return db.count('SELECT COUNT(*) AS total FROM contact_messages');
}

export async function removeSubscriber(db: Db, id: number): Promise<boolean> {
  const changes = await db.changes('DELETE FROM newsletter_subscribers WHERE id = ?', [Number(id)]);
  return changes > 0;
}

export async function setContactMessageStatus(
  db: Db,
  id: number,
  status: 'new' | 'read' | 'archived',
): Promise<boolean> {
  const changes = await db.changes('UPDATE contact_messages SET status = ? WHERE id = ?', [
    status,
    Number(id),
  ]);
  return changes > 0;
}

export async function removeContactMessage(db: Db, id: number): Promise<boolean> {
  const changes = await db.changes('DELETE FROM contact_messages WHERE id = ?', [Number(id)]);
  return changes > 0;
}
