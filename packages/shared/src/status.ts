/**
 * Sholynk Tech — shared status/type vocabularies.
 *
 * Each tuple mirrors a CHECK constraint in database/migrations. Routes use the
 * derived Zod enums so an invalid status is rejected at the API boundary with a
 * field-level error instead of surfacing as a database constraint failure.
 */

/* ------------------------------- publishing ------------------------------ */

export const ARTICLE_STATUSES = ['published', 'draft', 'scheduled', 'pending'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const CONTENT_TYPES = ['article', 'news', 'guide', 'opinion', 'review', 'analysis'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const SOURCE_TYPES = ['primary', 'official', 'research', 'journalism', 'reference', 'other'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/* -------------------------------- engagement ----------------------------- */

export const REACTION_TYPES = ['like', 'dislike'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const SUBSCRIBER_STATUSES = ['active', 'unsubscribed'] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

export const MESSAGE_STATUSES = ['new', 'read', 'archived'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/* ---------------------------------- access -------------------------------- */

export const ACCOUNT_STATUSES = ['pending_verification', 'active', 'suspended', 'deactivated'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'info', 'success', 'warning', 'error', 'editorial', 'announcement',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const EMAIL_STATUSES = ['queued', 'logged', 'sent', 'failed'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/* ---------------------------------- limits --------------------------------- */

/** Numeric constants that mirror CHECK constraints, so code and schema agree. */
export const LIMITS = {
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,
  EMAIL_MAX_LENGTH: 254,
  DISPLAY_NAME_MIN: 2,
  DISPLAY_NAME_MAX: 80,

  ARTICLE_TITLE_MIN: 3,
  ARTICLE_TITLE_MAX: 200,
  ARTICLE_SLUG_MAX: 120,
  ARTICLE_DESCRIPTION_MAX: 500,
  ARTICLE_BODY_MAX: 400_000,
  ARTICLE_CATEGORY_MAX: 80,

  AUTHOR_NAME_MAX: 120,
  AUTHOR_BIO_MAX: 2000,

  COMMENT_AUTHOR_MAX: 60,
  COMMENT_BODY_MAX: 2000,

  VOTER_ID_MAX: 64,
  CLIENT_ID_MAX: 80,

  SUBSCRIBER_NAME_MAX: 120,
  MESSAGE_SUBJECT_MAX: 200,
  MESSAGE_BODY_MAX: 5000,

  LIST_LIMIT_DEFAULT: 100,
  LIST_LIMIT_MAX: 500,
  ANALYTICS_DAYS_DEFAULT: 30,
  ANALYTICS_DAYS_MAX: 365,
} as const;
