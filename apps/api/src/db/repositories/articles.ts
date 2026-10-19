/**
 * Repository — articles (the publication's content table).
 *
 * Faithful port of the legacy CMS module (cms/lib/articles.js) onto D1:
 *   - every article belongs to a registered author entity; a blank or unknown
 *     author slug falls back to the house author (the site owner),
 *   - slugs are unique, lowercase-hyphenated and stable; a rename carries the
 *     reader history (views/reactions/comments) across and leaves a 301
 *     redirect behind,
 *   - JSON-shaped editorial fields (tags, takeaways, FAQs, related slugs) are
 *     stored as TEXT columns and parsed on read.
 *
 * The API DTO is camelCase and matches the legacy contract exactly, because the
 * ported homepage, article renderer and admin dashboard all read it.
 */
import type { Db, SqlValue } from '../client.js';
import { slugify, uniqueSlug } from '../../lib/slug.js';
import { notFound } from '../../lib/errors.js';

/**
 * The site owner, who every article belongs to unless it names someone else.
 * Content created before any contributor registered — the original seed, hero
 * slides, imports — is his work, so this is the fallback rather than a generic
 * "editorial" byline that would leave articles attributed to nobody.
 */
export const HOUSE_AUTHOR = Object.freeze({
  slug: 'oluwashola-busari',
  name: 'Oluwashola Busari',
});

export interface ArticleSourceDto {
  id: number;
  articleId: number;
  title: string;
  publisher: string;
  author: string;
  publishedAt: string;
  url: string;
  type: string;
  doi: string;
  accessedAt: string;
  supports: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleDto {
  id: number;
  slug: string;
  title: string;
  category: string;
  subcategory: string;
  tags: string[];
  contentType: string;
  description: string;
  hook: string;
  directAnswer: string;
  keyTakeaways: string[];
  faqs: { question: string; answer: string }[];
  relatedSlugs: string[];
  body: string;
  img: string;
  alt: string;
  author: string;
  authorSlug: string;
  date: string;
  readingTime: string;
  featured: boolean;
  status: string;
  scheduledAt: string | null;
  reviewNotes: string;
  submittedAt: string | null;
  submitterEmail: string;
  hero: boolean;
  heroOrder: number | null;
  externalLink: string | null;
  canonicalUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  sources: ArticleSourceDto[];
  /** True when the article has a non-empty body. List summaries omit the body bytes. */
  hasBody: boolean;
  link: string;
  cleanLink: string;
  createdAt: string;
  updatedAt: string;
}

export type ArticleRow = Record<string, SqlValue> & {
  id: number;
  slug: string;
  title: string;
  status: string;
};

type SourceRow = Record<string, SqlValue>;

/* -------------------------------------------------------------------------- */
/* Row → DTO                                                                   */
/* -------------------------------------------------------------------------- */

function parseJsonList<T>(value: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') return value as T[];
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed == null ? fallback : (parsed as T[]);
  } catch {
    return fallback;
  }
}

export function asJson(value: unknown, fallback: unknown[] = []): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return JSON.stringify(fallback);
    }
  }
  return JSON.stringify(value == null ? fallback : value);
}

function sourceToApi(row: SourceRow | null): ArticleSourceDto | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    articleId: Number(row.article_id),
    title: String(row.title ?? ''),
    publisher: String(row.publisher ?? ''),
    author: String(row.author ?? ''),
    publishedAt: String(row.published_at ?? ''),
    url: String(row.url ?? ''),
    type: String(row.type ?? 'journalism'),
    doi: String(row.doi ?? ''),
    accessedAt: String(row.accessed_at ?? ''),
    supports: String(row.supports ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export async function sourcesForArticle(db: Db, articleId: number): Promise<ArticleSourceDto[]> {
  const rows = await db.all<SourceRow>(
    'SELECT * FROM article_sources WHERE article_id = ? ORDER BY id ASC',
    [articleId],
  );
  return rows.map((row) => sourceToApi(row)!);
}

/**
 * Maps a row to the public/admin DTO. `sources` may be supplied by the caller
 * (list queries batch them) or are fetched per article by the wrappers below.
 */
export type ArticleListMode = 'summary' | 'full';

const LIST_SUMMARY_COLUMNS = `id, slug, title, category, subcategory, tags_json, content_type,
  description, hook, direct_answer, related_slugs_json, img, alt, author, author_slug,
  published_at, reading_time, featured, status, scheduled_at, submitted_at, hero, hero_order,
  external_link, canonical_url, seo_title, seo_description, created_at, updated_at,
  CASE WHEN length(trim(body)) > 0 THEN 1 ELSE 0 END AS has_body`;

export function toApi(
  row: ArticleRow,
  sources: ArticleSourceDto[] = [],
  mode: ArticleListMode = 'full',
): ArticleDto {
  const str = (key: string): string => String((row as Record<string, SqlValue>)[key] ?? '');
  const num = (key: string): number | null => {
    const value = (row as Record<string, SqlValue>)[key];
    return value === null || value === undefined || value === '' ? null : Number(value);
  };
  const summary = mode === 'summary';
  const body = summary ? '' : str('body');
  const hasBody =
    row.has_body !== undefined && row.has_body !== null
      ? Boolean(Number(row.has_body))
      : Boolean(str('body').trim());
  const link = row.external_link ? String(row.external_link) : `articles/${encodeURIComponent(str('slug'))}/`;
  return {
    id: Number(row.id),
    slug: str('slug'),
    title: str('title'),
    category: str('category'),
    subcategory: str('subcategory'),
    tags: parseJsonList<string>(row.tags_json),
    contentType: str('content_type') || 'article',
    description: str('description'),
    hook: str('hook'),
    directAnswer: summary ? '' : str('direct_answer'),
    keyTakeaways: summary ? [] : parseJsonList<string>(row.key_takeaways_json),
    faqs: summary ? [] : parseJsonList<{ question: string; answer: string }>(row.faqs_json),
    relatedSlugs: parseJsonList<string>(row.related_slugs_json),
    body,
    img: str('img'),
    alt: str('alt'),
    author: str('author'),
    authorSlug: str('author_slug'),
    date: str('published_at'),
    readingTime: str('reading_time'),
    featured: Boolean(row.featured),
    status: str('status'),
    scheduledAt: (row.scheduled_at as string | null) ?? null,
    reviewNotes: summary ? '' : str('review_notes'),
    submittedAt: (row.submitted_at as string | null) ?? null,
    submitterEmail: summary ? '' : str('submitter_email'),
    hero: Boolean(row.hero),
    heroOrder: num('hero_order'),
    externalLink: (row.external_link as string | null) ?? null,
    canonicalUrl: (row.canonical_url as string | null) ?? null,
    seoTitle: (row.seo_title as string | null) ?? null,
    seoDescription: (row.seo_description as string | null) ?? null,
    sources: summary ? [] : sources,
    hasBody,
    // Full articles use the clean route rendered live by the edge.
    link,
    cleanLink: link,
    createdAt: str('created_at'),
    updatedAt: str('updated_at'),
  };
}

async function toDto(db: Db, row: ArticleRow | null): Promise<ArticleDto | null> {
  if (!row) return null;
  return toApi(row, await sourcesForArticle(db, Number(row.id)));
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface ArticleListFilters {
  ownerUserId?: string;
  category?: string;
  q?: string;
  status?: string; // 'published' | 'draft' | 'scheduled' | 'pending' | 'all'
  limit?: number;
  offset?: number;
  hero?: boolean;
}

function whereFor(filters: ArticleListFilters): { clause: string; params: SqlValue[] } {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  if (filters.ownerUserId) { clauses.push('owner_user_id = ?'); params.push(filters.ownerUserId); }
  if (filters.status && filters.status !== 'all') {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.category && filters.category !== 'All') {
    clauses.push('category = ?');
    params.push(filters.category);
  }
  if (filters.hero === true) clauses.push('hero = 1');
  if (filters.q) {
    clauses.push(
      '(lower(title) LIKE ? OR lower(description) LIKE ? OR lower(category) LIKE ? OR lower(tags_json) LIKE ?)',
    );
    const like = `%${String(filters.q).toLowerCase()}%`;
    params.push(like, like, like, like);
  }
  return { clause: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

const LIST_ORDER =
  ' ORDER BY featured DESC, hero_order IS NULL, hero_order ASC, published_at DESC, id DESC';

/**
 * Article list in the legacy order (featured first, then hero placement, then
 * newest). Sources are batched in one extra query instead of N+1. `summary`
 * skips body/FAQ/source blobs for card and sitemap reads.
 */
export async function list(
  db: Db,
  filters: ArticleListFilters = {},
  mode: ArticleListMode = 'full',
): Promise<ArticleDto[]> {
  const { clause, params } = whereFor(filters);
  const columns = mode === 'summary' ? LIST_SUMMARY_COLUMNS : '*';
  let sql = `SELECT ${columns} FROM articles${clause}${LIST_ORDER}`;
  const listParams = [...params];
  if (Number.isFinite(filters.limit)) {
    sql += ' LIMIT ?';
    listParams.push(Number(filters.limit));
    if (Number.isFinite(filters.offset)) {
      sql += ' OFFSET ?';
      listParams.push(Number(filters.offset));
    }
  }
  const rows = await db.all<ArticleRow>(sql, listParams);
  if (!rows.length) return [];

  if (mode === 'summary') {
    return rows.map((row) => toApi(row, [], 'summary'));
  }

  const ids = rows.map((row) => Number(row.id));
  const sourceRows = await db.all<SourceRow>(
    `SELECT * FROM article_sources WHERE article_id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`,
    ids,
  );
  const byArticle = new Map<number, ArticleSourceDto[]>();
  for (const row of sourceRows) {
    const dto = sourceToApi(row)!;
    const bucket = byArticle.get(dto.articleId) ?? [];
    bucket.push(dto);
    byArticle.set(dto.articleId, bucket);
  }
  return rows.map((row) => toApi(row, byArticle.get(Number(row.id)) ?? []));
}

export async function count(db: Db, filters: ArticleListFilters = {}): Promise<number> {
  const { clause, params } = whereFor(filters);
  return db.count(`SELECT COUNT(*) AS total FROM articles${clause}`, params);
}

export async function getById(db: Db, id: number | string): Promise<ArticleDto | null> {
  const row = await db.first<ArticleRow>('SELECT * FROM articles WHERE id = ?', [Number(id)]);
  return toDto(db, row);
}

export async function getBySlug(db: Db, slug: string): Promise<ArticleDto | null> {
  const row = await db.first<ArticleRow>('SELECT * FROM articles WHERE slug = ?', [String(slug)]);
  return toDto(db, row);
}

/** A published article with a renderable body, or null. */
export async function findLiveBySlug(db: Db, slug: string): Promise<ArticleDto | null> {
  const article = await getBySlug(db, slug);
  return article && article.status === 'published' ? article : null;
}

export async function findRedirect(db: Db, oldSlug: string): Promise<string | null> {
  const row = await db.first<{ new_slug: string }>(
    'SELECT new_slug FROM redirects WHERE old_slug = ?',
    [oldSlug],
  );
  return row?.new_slug ?? null;
}

export async function categories(db: Db, status = 'published'): Promise<string[]> {
  const rows = await db.all<{ category: string }>(
    'SELECT DISTINCT category FROM articles WHERE status = ? ORDER BY category ASC',
    [status],
  );
  return rows.map((row) => row.category);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export function estimateReadingTime(body: string = ''): string {
  const words = String(body).trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 200))} min read`;
}

/**
 * Resolves the author entity an article should point at. Every article must
 * belong to a registered author; a blank slug or one naming an entity that does
 * not exist falls back to the site owner rather than being written through.
 */
async function resolveAuthorSlug(db: Db, value: unknown): Promise<string> {
  const candidate = String(value ?? '').trim();
  if (candidate) {
    const known = await db.exists('SELECT 1 AS found FROM authors WHERE slug = ?', [candidate]);
    if (known) return candidate;
  }
  return HOUSE_AUTHOR.slug;
}

/**
 * Display name to store alongside a resolved author slug. When the slug had to
 * fall back, the supplied byline is discarded too: keeping it would print one
 * person's name on an article the dashboard credits to another.
 */
async function resolveAuthorName(
  db: Db,
  slug: string,
  provided: unknown,
  fellBack = false,
): Promise<string> {
  const name = String(provided ?? '').trim();
  if (name && !fellBack) return name;
  const row = await db.first<{ name: string }>('SELECT name FROM authors WHERE slug = ?', [slug]);
  return row?.name ?? HOUSE_AUTHOR.name;
}

export interface ArticleWriteInput {
  title?: string;
  category?: string;
  subcategory?: string;
  contentType?: string;
  slug?: string;
  description?: string;
  hook?: string;
  directAnswer?: string;
  body?: string;
  img?: string;
  alt?: string;
  author?: string;
  authorSlug?: string;
  submitterEmail?: string;
  date?: string;
  readingTime?: string;
  status?: string;
  scheduledAt?: string | null;
  reviewNotes?: string;
  heroOrder?: number | '' | null;
  externalLink?: string | null;
  canonicalUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  featured?: boolean;
  hero?: boolean;
  tags?: string[];
  keyTakeaways?: string[];
  relatedSlugs?: string[];
  faqs?: { question: string; answer: string }[];
  sources?: {
    title: string;
    publisher?: string;
    author?: string;
    publishedAt?: string;
    url: string;
    type?: string;
    doi?: string;
    accessedAt?: string;
    supports?: string;
  }[];
}

const INSERT_FIELDS = [
  'slug', 'title', 'category', 'description', 'body', 'img', 'alt', 'author', 'author_slug', 'published_at',
  'reading_time', 'featured', 'status', 'hero', 'hero_order', 'external_link', 'seo_title',
  'seo_description', 'content_type', 'subcategory', 'tags_json', 'hook', 'direct_answer',
  'key_takeaways_json', 'faqs_json', 'related_slugs_json', 'canonical_url', 'scheduled_at',
  'review_notes', 'submitter_email', 'submitted_at',
] as const;

export async function create(db: Db, payload: ArticleWriteInput, ownerUserId: string | null = null): Promise<ArticleDto> {
  const requestedAuthorSlug = String(payload.authorSlug ?? '').trim();
  const createAuthorSlug = await resolveAuthorSlug(db, requestedAuthorSlug);
  const createAuthorName = await resolveAuthorName(
    db,
    createAuthorSlug,
    payload.author,
    Boolean(requestedAuthorSlug) && requestedAuthorSlug !== createAuthorSlug,
  );

  const baseSlug = slugify(payload.slug || payload.title || '');
  const slug = await uniqueSlugFor(db, baseSlug);

  const isSubmission = payload.status === 'pending';
  const values: SqlValue[] = [
    slug,
    String(payload.title ?? '').trim(),
    String(payload.category ?? '').trim(),
    String(payload.description ?? ''),
    String(payload.body ?? ''),
    String(payload.img ?? ''),
    String(payload.alt ?? ''),
    createAuthorName,
    createAuthorSlug,
    String(payload.date || new Date().toISOString().slice(0, 10)),
    String(payload.readingTime || estimateReadingTime(payload.body ?? '')),
    payload.featured ? 1 : 0,
    payload.status ?? 'published',
    payload.hero ? 1 : 0,
    payload.heroOrder == null || payload.heroOrder === '' ? null : Number(payload.heroOrder),
    payload.externalLink || null,
    payload.seoTitle || null,
    payload.seoDescription || null,
    payload.contentType ?? 'article',
    String(payload.subcategory ?? ''),
    asJson(payload.tags),
    String(payload.hook ?? ''),
    String(payload.directAnswer ?? ''),
    asJson(payload.keyTakeaways),
    asJson(payload.faqs),
    asJson(payload.relatedSlugs),
    payload.canonicalUrl || null,
    payload.scheduledAt || null,
    String(payload.reviewNotes ?? ''),
    String(payload.submitterEmail ?? ''),
    isSubmission ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
  ];

  const result = await db.run(
    `INSERT INTO articles (${INSERT_FIELDS.join(',')}, owner_user_id) VALUES (${INSERT_FIELDS.map(() => '?').join(',')}, ?)`,
    [...values, ownerUserId],
  );
  const id = Number(result.lastRowId ?? 0);
  if (payload.sources) await replaceSources(db, id, payload.sources);
  const created = await getById(db, id);
  if (!created) throw notFound('Article not found');
  return created;
}

/** Retired URLs stay reserved; another author must not claim a redirect. */
async function uniqueSlugFor(db: Db, base: string, ignoreId?: number): Promise<string> {
  return uniqueSlug(base, (candidate) => db.exists(
    `SELECT 1 AS found FROM articles WHERE slug = ? AND id != ?
     UNION ALL SELECT 1 AS found FROM redirects WHERE old_slug = ? LIMIT 1`,
    [candidate, ignoreId ?? -1, candidate],
  ));
}

const FIELD_MAP: Readonly<Record<string, string>> = {
  title: 'title', category: 'category', subcategory: 'subcategory', contentType: 'content_type',
  description: 'description', hook: 'hook', directAnswer: 'direct_answer', body: 'body', img: 'img',
  alt: 'alt', author: 'author', authorSlug: 'author_slug', date: 'published_at',
  readingTime: 'reading_time', status: 'status', scheduledAt: 'scheduled_at', reviewNotes: 'review_notes',
  externalLink: 'external_link', canonicalUrl: 'canonical_url', seoTitle: 'seo_title',
  seoDescription: 'seo_description', submitterEmail: 'submitter_email',
};

const JSON_FIELD_MAP: Readonly<Record<string, string>> = {
  tags: 'tags_json', keyTakeaways: 'key_takeaways_json', faqs: 'faqs_json', relatedSlugs: 'related_slugs_json',
};

/**
 * Partial update with the legacy semantics, including the slug-rename
 * behaviour: reader history is keyed by slug, so a rename carries reactions,
 * comments and views across and records a redirect so the old URL keeps
 * working. A slug that comes back later must not resurrect a stale redirect.
 */
export async function update(
  db: Db,
  id: number,
  payload: ArticleWriteInput & { slug?: string },
): Promise<ArticleDto | null> {
  const existing = await getById(db, id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: SqlValue[] = [];
  const edited: ArticleWriteInput & { slug?: string } = { ...payload };

  if (Object.prototype.hasOwnProperty.call(edited, 'authorSlug')) {
    const requested = String(edited.authorSlug ?? '').trim();
    edited.authorSlug = await resolveAuthorSlug(db, requested);
    const fellBack = requested !== edited.authorSlug;
    if (fellBack || !String(edited.author ?? '').trim()) {
      edited.author = await resolveAuthorName(db, edited.authorSlug, edited.author || existing.author, fellBack);
    }
  }

  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (Object.prototype.hasOwnProperty.call(edited, key)) {
      const value = (edited as Record<string, unknown>)[key];
      sets.push(`${column} = ?`);
      params.push(value == null ? '' : String(value));
    }
  }
  for (const [key, column] of Object.entries(JSON_FIELD_MAP)) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      sets.push(`${column} = ?`);
      params.push(asJson((payload as Record<string, unknown>)[key]));
    }
  }
  for (const key of ['featured', 'hero'] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      sets.push(`${key} = ?`);
      params.push(payload[key] ? 1 : 0);
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'heroOrder')) {
    sets.push('hero_order = ?');
    params.push(payload.heroOrder === '' || payload.heroOrder == null ? null : Number(payload.heroOrder));
  }

  let renamedSlug: string | null = null;
  if (Object.prototype.hasOwnProperty.call(payload, 'slug') && payload.slug) {
    const nextSlug = await uniqueSlugFor(db, slugify(payload.slug), existing.id);
    if (nextSlug !== existing.slug) renamedSlug = nextSlug;
    sets.push('slug = ?');
    params.push(nextSlug);
  }

  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    params.push(existing.id);
    const statements = [db.prepare(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`, params)];
    if (renamedSlug) {
      statements.push(
        db.prepare('UPDATE reactions SET article_slug = ? WHERE article_slug = ?', [renamedSlug, existing.slug]),
        db.prepare('UPDATE comments SET article_slug = ? WHERE article_slug = ?', [renamedSlug, existing.slug]),
        db.prepare('UPDATE article_views SET article_slug = ? WHERE article_slug = ?', [renamedSlug, existing.slug]),
        // Keep the old URL working for anyone who already shared it.
        db.prepare('INSERT OR REPLACE INTO redirects (old_slug, new_slug) VALUES (?, ?)', [
          existing.slug,
          renamedSlug,
        ]),
        // A slug that comes back later must not resurrect a stale redirect.
        db.prepare('DELETE FROM redirects WHERE old_slug = ?', [renamedSlug]),
      );
    }
    // D1 executes a batch in an implicit transaction: a partially applied
    // rename is never observable.
    await db.batch(statements);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'sources')) {
    await replaceSources(db, existing.id, payload.sources ?? []);
  }
  return getById(db, existing.id);
}

/**
 * Deletes an article and the reader history attached to it. Reactions,
 * comments and reads are keyed by slug rather than by a foreign key, so nothing
 * cascades automatically; left behind, those rows keep inflating the site-wide
 * totals while belonging to no article.
 */
export async function remove(db: Db, id: number): Promise<boolean> {
  const existing = await getById(db, id);
  if (!existing) return false;
  await db.batch([
    db.prepare('DELETE FROM reactions WHERE article_slug = ?', [existing.slug]),
    db.prepare('DELETE FROM comments WHERE article_slug = ?', [existing.slug]),
    db.prepare('DELETE FROM article_views WHERE article_slug = ?', [existing.slug]),
    db.prepare('DELETE FROM articles WHERE id = ?', [existing.id]),
  ]);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                     */
/* -------------------------------------------------------------------------- */

const SOURCE_TYPES = new Set(['primary', 'official', 'research', 'journalism', 'reference', 'other']);

export async function replaceSources(
  db: Db,
  articleId: number,
  sources: ArticleWriteInput['sources'] = [],
): Promise<void> {
  const list = Array.isArray(sources) ? sources : [];
  const statements = [db.prepare('DELETE FROM article_sources WHERE article_id = ?', [articleId])];
  for (const source of list) {
    statements.push(
      db.prepare(
        `INSERT INTO article_sources
           (article_id, title, publisher, author, published_at, url, type, doi, accessed_at, supports)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          articleId,
          String(source.title).trim(),
          String(source.publisher ?? ''),
          String(source.author ?? ''),
          String(source.publishedAt ?? ''),
          String(source.url),
          SOURCE_TYPES.has(String(source.type)) ? String(source.type) : 'journalism',
          String(source.doi ?? ''),
          String(source.accessedAt ?? ''),
          String(source.supports ?? ''),
        ],
      ),
    );
  }
  await db.batch(statements);
}

export async function addSource(
  db: Db,
  articleId: number,
  source: NonNullable<ArticleWriteInput['sources']>[number],
): Promise<ArticleSourceDto | null> {
  const article = await getById(db, articleId);
  if (!article) return null;
  const result = await db.run(
    `INSERT INTO article_sources
       (article_id, title, publisher, author, published_at, url, type, doi, accessed_at, supports)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      article.id,
      String(source.title).trim(),
      String(source.publisher ?? ''),
      String(source.author ?? ''),
      String(source.publishedAt ?? ''),
      String(source.url),
      SOURCE_TYPES.has(String(source.type)) ? String(source.type) : 'journalism',
      String(source.doi ?? ''),
      String(source.accessedAt ?? ''),
      String(source.supports ?? ''),
    ],
  );
  const row = await db.first<SourceRow>('SELECT * FROM article_sources WHERE id = ?', [
    Number(result.lastRowId ?? 0),
  ]);
  return sourceToApi(row);
}

export async function removeSource(db: Db, articleId: number, sourceId: number): Promise<boolean> {
  const changes = await db.changes('DELETE FROM article_sources WHERE id = ? AND article_id = ?', [
    Number(sourceId),
    Number(articleId),
  ]);
  return changes > 0;
}

/* -------------------------------------------------------------------------- */
/* Submissions + scheduling                                                    */
/* -------------------------------------------------------------------------- */

/** Records one "submitted for review" event in the editorial trail. */
export async function recordSubmission(db: Db, article: ArticleDto, notes = ''): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO submissions (article_id, article_slug, title, author_name, submitter_email, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        article.id,
        article.slug,
        article.title,
        article.author,
        article.submitterEmail || '',
        String(notes || ''),
      ],
    ),
    db.prepare("UPDATE articles SET submitted_at = COALESCE(submitted_at, datetime('now')) WHERE id = ?", [
      article.id,
    ]),
  ]);
}

/**
 * Publishes every scheduled article whose time has come. Run by the nightly
 * cron trigger; returns the number of articles flipped to published.
 */
export async function publishDueScheduled(db: Db): Promise<number> {
  return db.changes(
    `UPDATE articles
        SET status = 'published',
            published_at = COALESCE(date(scheduled_at), date('now')),
            updated_at = datetime('now')
      WHERE status = 'scheduled'
        AND scheduled_at IS NOT NULL
        AND datetime(scheduled_at) <= datetime('now')
        AND NOT EXISTS (SELECT 1 FROM author_applications app JOIN users u ON u.id = app.user_id
          WHERE app.user_id = articles.owner_user_id AND (app.status <> 'approved' OR u.status <> 'active'))`,
  );
}

/**
 * Attributes any article that points at no author entity to the site owner
 * (legacy authors.js behaviour, run from housekeeping instead of at startup).
 */
export async function attributeOrphanedArticles(db: Db): Promise<number> {
  return db.changes(
    `UPDATE articles SET author_slug = ?, author = ?, updated_at = datetime('now')
      WHERE author_slug = '' OR author_slug NOT IN (SELECT slug FROM authors)`,
    [HOUSE_AUTHOR.slug, HOUSE_AUTHOR.name],
  );
}

export { slugify };
