/**
 * Sholynk Tech — request validation schemas (Zod 4).
 *
 * These schemas are the contract between the frontend, the API and the tests:
 *   - the API validates body/query/params with them (422 + field errors)
 *   - integration tests import the same objects to build valid payloads
 *   - the shape of every payload is therefore documented in exactly one place
 *
 * Validation is deliberately strict: unknown keys are stripped, strings are
 * trimmed, and every length/range bound matches a CHECK constraint in the SQL
 * migrations so a schema change cannot be forgotten on either side.
 *
 * The article rules mirror the editorial contract of the legacy Sholynk CMS
 * (cms/lib/articles.js + requireSubmissionFields in cms/routes/api.js), so a
 * submission that the old dashboard accepted is accepted here too — with the
 * same human-readable messages.
 */
import { z } from 'zod';
import {
  ARTICLE_STATUSES,
  CONTENT_TYPES,
  LIMITS,
  MESSAGE_STATUSES,
  REACTION_TYPES,
  SOURCE_TYPES,
} from './status.js';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

export const idSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Identifiers may contain letters, digits, dash and underscore only');

/**
 * Normalisation happens *before* the format check on purpose: phones and
 * password managers routinely hand us " editor@example.com" and a user should
 * not be told their address is invalid because of a stray space.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(LIMITS.EMAIL_MAX_LENGTH, `Email must be at most ${LIMITS.EMAIL_MAX_LENGTH} characters`)
  .pipe(z.email('Enter a valid email address'));

export const passwordSchema = z
  .string()
  .min(LIMITS.PASSWORD_MIN_LENGTH, `Password must be at least ${LIMITS.PASSWORD_MIN_LENGTH} characters`)
  .max(LIMITS.PASSWORD_MAX_LENGTH, `Password must be at most ${LIMITS.PASSWORD_MAX_LENGTH} characters`)
  .refine((value) => /[a-z]/.test(value), 'Include at least one lowercase letter')
  .refine((value) => /[A-Z]/.test(value) || /[0-9]/.test(value), 'Include at least one uppercase letter or digit');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(LIMITS.ARTICLE_SLUG_MAX)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single dashes');

export const displayNameSchema = z
  .string()
  .trim()
  .min(LIMITS.DISPLAY_NAME_MIN)
  .max(LIMITS.DISPLAY_NAME_MAX);

export const urlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => /^https:\/\/[^\s]+$/i.test(value) || /^\/[^\s]*$/.test(value), {
    message: 'Use an https:// URL or a site-relative path',
  });

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

export const intFromQuery = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

/* -------------------------------------------------------------------------- */
/* Authentication                                                              */
/* -------------------------------------------------------------------------- */

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  display_name: displayNameSchema.optional(),
  full_name: optionalText(120),
  accepted_terms: z.literal(true, { message: 'You must accept the terms to register' }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(LIMITS.PASSWORD_MAX_LENGTH),
  remember: z.boolean().optional().default(false),
});

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const resendVerificationSchema = z.object({ email: emailSchema });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(LIMITS.PASSWORD_MAX_LENGTH),
  new_password: passwordSchema,
});

export const updateProfileSchema = z
  .object({
    display_name: displayNameSchema.optional(),
    full_name: optionalText(120),
    bio: optionalText(1000),
    avatar_url: urlSchema.optional(),
    website: urlSchema.optional(),
    country: optionalText(80),
    timezone: optionalText(60),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

/* -------------------------------------------------------------------------- */
/* Articles                                                                    */
/* -------------------------------------------------------------------------- */

const isValidDate = (value: string): boolean => !Number.isNaN(new Date(value).valueOf());

/** An absolute HTTP(S) URL — used for source links. */
const httpUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => /^https?:\/\/[^\s]+$/i.test(value), 'Must be an absolute HTTP(S) URL');

/** HTTPS-only absolute URL — canonical URLs must never point at plain HTTP. */
const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => /^https:\/\/[^\s]+$/i.test(value), 'canonicalUrl must be an absolute HTTPS URL');

/**
 * The legacy `validLink` rule: an HTTP(S) URL, or a local path that cannot
 * execute a scheme (`javascript:`, `data:`) or protocol-relative redirect.
 */
const safeLinkSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    if (/^https?:\/\/[^\s]+$/i.test(value)) return true;
    return (
      !/[\\\u0000-\u001f]/.test(value) &&
      !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
      !value.startsWith('//')
    );
  }, 'externalLink must be an HTTP(S) URL or safe local path');

export const faqSchema = z.object({
  question: z.string().trim().min(1, 'FAQ question is required').max(500),
  answer: z.string().trim().min(1, 'FAQ answer is required').max(4000),
});

export const articleSourceSchema = z.object({
  title: z.string().trim().min(1, 'source title is required').max(300),
  publisher: z.string().trim().max(200).optional().default(''),
  author: z.string().trim().max(200).optional().default(''),
  publishedAt: z.string().trim().max(60).optional().default(''),
  url: httpUrlSchema,
  type: z.enum(SOURCE_TYPES).optional().default('journalism'),
  doi: z.string().trim().max(200).optional().default(''),
  accessedAt: z.string().trim().max(60).optional().default(''),
  supports: z.string().trim().max(2000).optional().default(''),
});

const tagListSchema = z
  .array(z.string().trim().min(1, 'tags cannot contain empty values').max(80))
  .max(30);

const stringListSchema = (max: number) =>
  z.array(z.string().trim().min(1, 'List items cannot be empty').max(500)).max(max);

/**
 * Everything an article write may carry. Mirrors the legacy CMS payload 1:1 so
 * the ported admin dashboard keeps working; the conditional editorial rules
 * live in `refineArticlePayload` below (shared by create and update).
 */
export const articleInputSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(LIMITS.ARTICLE_TITLE_MAX),
  category: z.string().trim().min(1, 'category is required').max(LIMITS.ARTICLE_CATEGORY_MAX),
  subcategory: z.string().trim().max(120).optional().default(''),
  contentType: z.enum(CONTENT_TYPES).optional().default('article'),
  slug: slugSchema.optional(),
  description: z.string().trim().max(LIMITS.ARTICLE_DESCRIPTION_MAX).optional().default(''),
  hook: z.string().trim().max(1000).optional().default(''),
  directAnswer: z.string().trim().max(2000).optional().default(''),
  body: z.string().max(LIMITS.ARTICLE_BODY_MAX).optional().default(''),
  img: z.string().trim().max(2048).optional().default(''),
  alt: z.string().trim().max(500).optional().default(''),
  author: z.string().trim().max(LIMITS.AUTHOR_NAME_MAX).optional().default(''),
  authorSlug: slugSchema.optional(),
  submitterEmail: z.union([z.literal(''), emailSchema]).optional().default(''),
  date: z
    .string()
    .trim()
    .max(60)
    .optional()
    .refine((value) => !value || isValidDate(value), 'date must be a valid date'),
  readingTime: z.string().trim().max(40).optional(),
  status: z.enum(ARTICLE_STATUSES).optional(),
  scheduledAt: z
    .string()
    .trim()
    .max(60)
    .optional()
    .refine((value) => !value || isValidDate(value), 'scheduledAt must be a valid date and time'),
  reviewNotes: z.string().trim().max(4000).optional().default(''),
  heroOrder: z
    .union([z.literal(''), z.coerce.number().int().min(0).max(999)])
    .optional()
    .nullable(),
  externalLink: safeLinkSchema.optional().nullable(),
  canonicalUrl: z.union([z.literal(''), httpsUrlSchema]).optional().nullable(),
  seoTitle: z.string().trim().max(200).optional().nullable(),
  seoDescription: z.string().trim().max(500).optional().nullable(),
  featured: z.boolean().optional(),
  hero: z.boolean().optional(),
  tags: tagListSchema.optional(),
  keyTakeaways: stringListSchema(20).optional(),
  relatedSlugs: z
    .array(slugSchema)
    .max(20)
    .optional(),
  faqs: z.array(faqSchema).max(30).optional(),
  sources: z.array(articleSourceSchema).max(50).optional(),
});

export const articleUpdateSchema = articleInputSchema.partial();

/**
 * Cross-field editorial rules, applied to the *merged* article (the incoming
 * payload over the stored row for updates). Returns human-readable messages,
 * in the same wording the legacy CMS used, so the dashboard's validation panel
 * reads identically.
 */
export function refineArticlePayload(article: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const str = (value: unknown): string => String(value ?? '').trim();

  if (article.img !== undefined && str(article.img) && !str(article.alt)) {
    errors.push('alt text is required whenever an image is set (accessibility)');
  }
  if (article.status === 'scheduled' && !str(article.scheduledAt)) {
    errors.push('scheduledAt is required when status is scheduled');
  }
  if (article.relatedSlugs && Array.isArray(article.relatedSlugs)) {
    const bad = (article.relatedSlugs as unknown[]).some(
      (slug) => typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug),
    );
    if (bad) errors.push('relatedSlugs must contain lowercase hyphenated slugs');
  }
  if (article.authorSlug !== undefined && str(article.authorSlug)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(str(article.authorSlug))) {
      errors.push('authorSlug must be a lowercase hyphenated slug');
    }
  }

  /* The "ready for review" bar — only enforced when submitting for review. */
  if (article.status === 'pending') {
    if (str(article.title).length < 6) errors.push('Title is required (min 6 characters)');
    if (!str(article.category)) errors.push('Category is required');
    const body = str(article.body);
    if (body.length < 200) {
      errors.push('Article body must be at least 200 characters for review');
    }
    if (!/<h2\b/i.test(body) && !/^##\s+/m.test(body)) {
      errors.push(
        'Add at least one <h2> section heading or Markdown ## heading so readers can navigate the article',
      );
    }
    const description = str(article.description);
    if (description.length < 40) errors.push('Description/teaser is required (min 40 characters)');
    if (description.length > 200) errors.push('Description must be under 200 characters');
    if ((Array.isArray(article.tags) ? (article.tags as unknown[]) : []).length < 2) {
      errors.push('Add at least 2 tags');
    }
    if (str(article.img) && !str(article.alt)) {
      errors.push('Image alt text is required whenever a hero image is set');
    }
  }
  return errors;
}

export const articleListQuerySchema = z.object({
  category: z.string().trim().max(LIMITS.ARTICLE_CATEGORY_MAX).optional(),
  q: z.string().trim().max(120).optional(),
  status: z.union([z.enum(ARTICLE_STATUSES), z.literal('all')]).default('published'),
  hero: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),
  limit: z.coerce.number().int().min(1).max(LIMITS.LIST_LIMIT_MAX).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

export const idOrSlugParamSchema = z.string().trim().min(1).max(LIMITS.ARTICLE_SLUG_MAX);

/* -------------------------------------------------------------------------- */
/* Authors                                                                     */
/* -------------------------------------------------------------------------- */

const authorInputObject = z
  .object({
    name: z.string().trim().min(1, 'author name is required').max(LIMITS.AUTHOR_NAME_MAX),
    slug: slugSchema.optional(),
    role: z.string().trim().max(160).optional().default(''),
    bio: z.string().trim().max(LIMITS.AUTHOR_BIO_MAX).optional().default(''),
    image: z.string().trim().max(2048).optional().default(''),
    imageAlt: z.string().trim().max(500).optional().default(''),
    profileUrl: z
      .string()
      .trim()
      .max(2048)
      .optional()
      .default('')
      .refine((value) => {
        if (!value) return true;
        // A local path (no scheme, not protocol-relative) or an absolute
        // HTTPS URL — the legacy authors.js rule, without the URL constructor
        // so this package stays free of runtime platform assumptions.
        const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
        if (!hasScheme) return !value.startsWith('//') && !/[\u0000-\u001f\\]/.test(value);
        return /^https:\/\/[^\s]+$/i.test(value);
      }, 'author profileUrl must be a local path or an absolute HTTPS URL'),
  })
export const authorInputSchema = authorInputObject.refine(
  (value) => !value.image || Boolean(value.imageAlt.trim()),
  {
    message: 'author imageAlt is required whenever an image is set',
    path: ['imageAlt'],
  },
);

/**
 * Partial updates are validated against the *merged* author in the repository
 * (an image can never lose its alt text through a patch), so the cross-field
 * refine deliberately does not apply to this shape.
 */
export const authorUpdateSchema = authorInputObject.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Nothing to update',
);

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export const settingsSchema = z.object({
  siteTitle: z.string().trim().max(200).optional(),
  siteDescription: z.string().trim().max(500).optional(),
  siteKeywords: z.string().trim().max(500).optional(),
  homeTagline: z.string().trim().max(200).optional(),
});

/* -------------------------------------------------------------------------- */
/* Reader engagement                                                           */
/* -------------------------------------------------------------------------- */

const voterIdSchema = z.string().trim().min(1, 'voterId is required').max(LIMITS.VOTER_ID_MAX);

export const reactionSchema = z.object({
  voterId: voterIdSchema,
  type: z.enum(REACTION_TYPES, { message: "type must be 'like' or 'dislike'" }),
});

export const commentSchema = z.object({
  author: z
    .string()
    .trim()
    .min(1, 'name is required')
    .max(LIMITS.COMMENT_AUTHOR_MAX, `name must be ${LIMITS.COMMENT_AUTHOR_MAX} characters or fewer`)
    .transform((value) => value.replace(/\s+/g, ' ')),
  body: z
    .string()
    .trim()
    .min(1, 'comment is required')
    .max(
      LIMITS.COMMENT_BODY_MAX,
      `comment must be ${LIMITS.COMMENT_BODY_MAX} characters or fewer`,
    ),
  voterId: z.string().trim().max(LIMITS.VOTER_ID_MAX).optional().default(''),
  clientId: z.string().trim().max(LIMITS.CLIENT_ID_MAX).optional().default(''),
});

export const viewSchema = z.object({
  voterId: z.string().trim().max(LIMITS.VOTER_ID_MAX).optional(),
  viewerId: z.string().trim().max(LIMITS.VOTER_ID_MAX).optional(),
});

export const engagementQuerySchema = z.object({
  voterId: z.string().trim().max(LIMITS.VOTER_ID_MAX).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.LIST_LIMIT_MAX).optional(),
});

/* -------------------------------------------------------------------------- */
/* Public forms (newsletter + contact)                                         */
/* -------------------------------------------------------------------------- */

/**
 * The hidden honeypot fields. A bot fills them; the form handler pretends to
 * accept the submission and stores nothing.
 */
const honeypotFields = {
  'bot-field': z.string().max(500).optional(),
  website: z.string().max(500).optional(),
  companyWebsite: z.string().max(500).optional(),
};

export const subscribeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(LIMITS.SUBSCRIBER_NAME_MAX),
  email: emailSchema,
  ...honeypotFields,
});

export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(LIMITS.SUBSCRIBER_NAME_MAX),
  email: emailSchema,
  subject: z.string().trim().min(1, 'Subject is required').max(LIMITS.MESSAGE_SUBJECT_MAX),
  message: z
    .string()
    .trim()
    .min(10, 'Message must be at least 10 characters')
    .max(LIMITS.MESSAGE_BODY_MAX),
  ...honeypotFields,
});

/* -------------------------------------------------------------------------- */
/* Admin listing / management queries                                          */
/* -------------------------------------------------------------------------- */

export const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(LIMITS.LIST_LIMIT_MAX).optional(),
});

export const analyticsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.ANALYTICS_DAYS_MAX)
    .default(LIMITS.ANALYTICS_DAYS_DEFAULT),
});

export const messageStatusSchema = z.object({ status: z.enum(MESSAGE_STATUSES) });

export const imageAltSchema = z.object({
  alt: z.string().trim().max(500).optional().default(''),
});
