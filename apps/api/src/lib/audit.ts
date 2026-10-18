/**
 * Sholynk Tech — audit trail helpers (pure part).
 *
 * `audit_logs` is append-only and is written for every privileged or
 * security-relevant action: editorial content changes, role changes,
 * moderation actions, sign-in failures and account status changes.
 *
 * Persistence lives in db/repositories/audit.ts; the naming, sanitisation and
 * diffing rules live here so they can be unit-tested without a database.
 */

export const AUDIT_ACTIONS = {
  // authentication & account
  authRegister: 'auth.register',
  authLogin: 'auth.login',
  authLoginFailed: 'auth.login.failed',
  authLogout: 'auth.logout',
  authPasswordResetRequested: 'auth.password_reset.requested',
  authPasswordReset: 'auth.password_reset.completed',
  authPasswordChanged: 'auth.password.changed',
  authEmailVerified: 'auth.email.verified',
  authEmailVerificationResent: 'auth.email.verification_resent',
  // users & roles
  userUpdated: 'user.updated',
  userStatusChanged: 'user.status.changed',
  userRoleChanged: 'user.role.changed',
  adminCreated: 'admin.created',
  // editorial content
  articleCreated: 'article.created',
  articleUpdated: 'article.updated',
  articlePublished: 'article.published',
  articleSubmitted: 'article.submitted',
  articleDeleted: 'article.deleted',
  authorCreated: 'author.created',
  authorUpdated: 'author.updated',
  authorDeleted: 'author.deleted',
  settingsUpdated: 'settings.updated',
  // media
  imageUploaded: 'image.uploaded',
  imageUpdated: 'image.updated',
  imageDeleted: 'image.deleted',
  // engagement & inbox
  commentDeleted: 'comment.deleted',
  subscriberDeleted: 'subscriber.deleted',
  contactMessageUpdated: 'contact_message.updated',
  contactMessageDeleted: 'contact_message.deleted',
  // platform
  systemMigration: 'system.migration.applied',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntryInput {
  action: AuditAction | string;
  actorUserId?: string | null;
  actorRole?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  status?: 'success' | 'failure';
  ipHash?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

const METADATA_MAX_BYTES = 4000;

/**
 * Redacts anything that looks like a credential before it reaches the log
 * table, and caps the payload size so a large diff cannot bloat the database.
 */
export function sanitizeMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return '{}';

  const SENSITIVE = new Set([
    'password', 'new_password', 'current_password', 'password_hash', 'token', 'token_hash',
    'confirmation_code', 'confirmation_hash', 'bootstrap_password_hash', 'x-owner-confirmation',
    'secret', 'session_secret', 'api_key', 'authorization', 'cookie', 'answer_text',
    'selected_option_ids', 'submission_text',
  ]);

  const scrub = (value: unknown, depth: number): unknown => {
    if (depth > 4) return '[truncated]';
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrub(item, depth + 1));
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        out[key] = SENSITIVE.has(key.toLowerCase()) ? '[redacted]' : scrub(inner, depth + 1);
      }
      return out;
    }
    if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
    return value;
  };

  let json = JSON.stringify(scrub(metadata, 0));
  if (json.length > METADATA_MAX_BYTES) {
    json = JSON.stringify({ truncated: true, note: 'metadata exceeded size limit' });
  }
  return json;
}

/** Field-level diff used by content-update audit entries. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, next] of Object.entries(after)) {
    if (next === undefined) continue;
    const previous = before[key];
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changes[key] = { from: previous ?? null, to: next };
    }
  }
  return changes;
}

export function isAuditAction(value: string): value is AuditAction {
  return Object.values(AUDIT_ACTIONS).includes(value as AuditAction);
}

/** Short human summary shown in the admin audit table. */
export function describeAuditEntry(entry: Pick<AuditEntryInput, 'action' | 'entityType' | 'status'>): string {
  const action = entry.action.replace(/[._]/g, ' ');
  const entity = entry.entityType ? ` (${entry.entityType})` : '';
  const suffix = entry.status === 'failure' ? ' — failed' : '';
  return `${action}${entity}${suffix}`;
}
