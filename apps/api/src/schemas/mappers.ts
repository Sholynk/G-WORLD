/**
 * DTO mappers — database rows to API payloads.
 *
 * Two jobs, both security-relevant:
 *
 *   1. **Shape.** Account JSON is emitted in snake_case matching the SQL
 *      columns; editorial content keeps the legacy CMS's camelCase contract
 *      because the ported frontend reads it (see db/repositories/articles.ts).
 *
 *   2. **Redaction.** Every mapper is an allow-list: fields that must not leave
 *      the server (password hashes, token hashes, internal notes) are simply
 *      not copied. A column added to a table in a future migration is therefore
 *      *not* exposed until a mapper is updated — the safe default.
 */
import type { NotificationRow } from '../db/repositories/notifications.js';
import type { AuditRow } from '../db/repositories/audit.js';
import type { UserRow, UserSummary } from '../db/repositories/users.js';

/* ---------------------------------- users --------------------------------- */

export function toUserProfileDto(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role_key,
    role_rank: row.role_rank,
    status: row.status,
    email_verified: row.email_verified_at !== null,
    display_name: row.display_name,
    full_name: row.full_name,
    bio: row.bio,
    avatar_url: row.avatar_url,
    website: row.website,
    country: row.country,
    timezone: row.timezone,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
  };
}

export function toUserAdminDto(row: UserRow) {
  return {
    ...toUserProfileDto(row),
    locked_until: row.locked_until,
    failed_login_attempts: row.failed_login_attempts,
  };
}

export function toUserSummaryDto(row: UserSummary) {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    role: row.role_key,
    display_name: row.display_name,
    email_verified: row.email_verified_at !== null,
    created_at: row.created_at,
  };
}

/* ------------------------------ notifications ------------------------------ */

export function toNotificationDto(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link_url: row.link_url,
    read_at: row.read_at,
    created_at: row.created_at,
  };
}

/* ---------------------------------- audit ---------------------------------- */

export function toAuditDto(row: AuditRow) {
  let metadata: unknown = {};
  try {
    metadata = JSON.parse(row.metadata_json || '{}');
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    actor_user_id: row.actor_user_id,
    actor_role: row.actor_role,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    description: row.description,
    status: row.status,
    metadata,
    created_at: row.created_at,
  };
}
