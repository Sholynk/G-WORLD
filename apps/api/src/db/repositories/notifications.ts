/**
 * Repository — in-app notifications.
 *
 * Notifications are written whenever something asynchronous happens to a
 * learner: enrollment confirmed, quiz graded, certificate issued, account
 * suspended. Broadcasting (user_id IS NULL) is reserved for administrators.
 */
import type { Db } from '../client.js';
import type { NotificationType } from '@sholynk/shared';
import { newId, ID_PREFIXES } from '../../lib/ids.js';

export interface NotificationRow {
  id: string;
  user_id: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
}

export interface CreateNotificationInput {
  userId: string | null;
  type?: NotificationType;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
}

export async function createNotification(db: Db, input: CreateNotificationInput): Promise<string> {
  const id = newId(ID_PREFIXES.notification);
  await db.run(
    `INSERT INTO notifications (id, user_id, type, title, body, link_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.userId, input.type ?? 'info', input.title.slice(0, 160), input.body ?? null, input.linkUrl ?? null],
  );
  return id;
}

export interface ListNotificationsOptions {
  page: number;
  perPage: number;
  unreadOnly?: boolean;
}

export async function listForUser(
  db: Db,
  userId: string,
  options: ListNotificationsOptions,
): Promise<{ items: NotificationRow[]; total: number }> {
  const unreadClause = options.unreadOnly ? 'AND read_at IS NULL' : '';
  const total = await db.count(
    `SELECT COUNT(*) AS total FROM notifications
      WHERE (user_id = ? OR user_id IS NULL) ${unreadClause}`,
    [userId],
  );
  const items = await db.all<NotificationRow>(
    `SELECT id, user_id, type, title, body, link_url, read_at, created_at
       FROM notifications
      WHERE (user_id = ? OR user_id IS NULL) ${unreadClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    [userId, options.perPage, (options.page - 1) * options.perPage],
  );
  return { items, total };
}

export async function unreadCount(db: Db, userId: string): Promise<number> {
  return db.count(
    `SELECT COUNT(*) AS total FROM notifications
      WHERE (user_id = ? OR user_id IS NULL) AND read_at IS NULL`,
    [userId],
  );
}

export async function markRead(db: Db, userId: string, notificationId: string): Promise<number> {
  return db.changes(
    `UPDATE notifications SET read_at = ?
      WHERE id = ? AND (user_id = ? OR user_id IS NULL) AND read_at IS NULL`,
    [new Date().toISOString(), notificationId, userId],
  );
}

export async function markAllRead(db: Db, userId: string): Promise<number> {
  return db.changes(
    `UPDATE notifications SET read_at = ?
      WHERE (user_id = ? OR user_id IS NULL) AND read_at IS NULL`,
    [new Date().toISOString(), userId],
  );
}
