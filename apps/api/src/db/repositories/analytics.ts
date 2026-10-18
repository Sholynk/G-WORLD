/**
 * Repository — editorial analytics: the aggregate figures behind the dashboard.
 *
 * Faithful port of the legacy CMS module (cms/lib/analytics.js). Everything is
 * derived on read from the tables the site already writes to (articles,
 * authors, reactions, comments, submissions) plus `article_views`, which this
 * module owns. There is no separate metrics store to keep in sync, so a number
 * on the dashboard can never disagree with the content it counts.
 *
 * Readers are identified only by the anonymous browser id the engagement
 * widgets already generate. No accounts, no IP addresses, no personal data.
 */
import type { Db } from '../client.js';

const MAX_SLUG_LENGTH = 120;
const MAX_VIEWER_LENGTH = 64;

/** Statuses reported individually; anything else is folded into "other". */
const REPORTED_STATUSES = ['published', 'draft', 'scheduled', 'pending'] as const;

function normalizeSlug(value: unknown): string {
  return String(value ?? '').trim().slice(0, MAX_SLUG_LENGTH);
}

/**
 * Clamps a requested reporting window to a whole number of days. Rounding
 * matters: a fractional span would ask SQLite for a fractional day offset and
 * produce a series whose length disagrees with the period the dashboard says
 * it is showing.
 */
export function normalizeSpan(days: unknown): number {
  const parsed = Math.floor(Number(days));
  if (!Number.isFinite(parsed) || parsed < 1) return 30;
  return Math.min(parsed, 365);
}

/* --------------------------------- writes ---------------------------------- */

export interface RecordViewResult {
  counted: boolean;
  reason?: 'invalid-slug' | 'unknown-article' | 'already-counted-today';
}

/**
 * Records one article read. Returns `{ counted }` so the caller can tell a
 * fresh read from a repeat visit that the unique-per-day rule collapsed.
 * Unknown slugs are rejected: without that check the endpoint is an open write
 * for arbitrary strings.
 */
export async function recordView(
  db: Db,
  slug: string,
  input: { voterId?: string; viewerId?: string } = {},
): Promise<RecordViewResult> {
  const articleSlug = normalizeSlug(slug);
  if (!articleSlug) return { counted: false, reason: 'invalid-slug' };

  const known = await db.exists('SELECT 1 AS found FROM articles WHERE slug = ?', [articleSlug]);
  if (!known) return { counted: false, reason: 'unknown-article' };

  // `voterId` is the name the engagement widgets already use for the anonymous
  // browser id; `viewerId` is accepted as a synonym for direct API callers.
  const viewer = String(input.voterId || input.viewerId || '').trim().slice(0, MAX_VIEWER_LENGTH);

  // INSERT OR IGNORE + the partial unique index collapse repeat reads by the
  // same viewer on the same day; `changes` tells the two cases apart.
  const changes = await db.changes(
    `INSERT OR IGNORE INTO article_views (article_slug, viewer_id) VALUES (?, ?)`,
    [articleSlug, viewer],
  );
  return changes > 0 ? { counted: true } : { counted: false, reason: 'already-counted-today' };
}

/* ---------------------------------- reads ---------------------------------- */

export interface StatusBreakdown {
  published: number;
  draft: number;
  scheduled: number;
  pending: number;
  other: number;
}

export async function statusBreakdown(db: Db): Promise<StatusBreakdown> {
  const rows = await db.all<{ status: string; total: number }>(
    'SELECT status, COUNT(*) AS total FROM articles GROUP BY status',
  );
  const breakdown: StatusBreakdown = { published: 0, draft: 0, scheduled: 0, pending: 0, other: 0 };
  for (const row of rows) {
    const status = row.status as keyof StatusBreakdown;
    if ((REPORTED_STATUSES as readonly string[]).includes(row.status)) {
      breakdown[status] = Number(row.total);
    } else {
      breakdown.other += Number(row.total);
    }
  }
  return breakdown;
}

export interface SeriesPoint {
  date: string;
  views: number;
  readers: number;
  comments: number;
  reactions: number;
  published: number;
}

/**
 * A day-by-day series with no gaps. SQL only returns days that have rows, so a
 * quiet day would be missing entirely and a line chart would join across it and
 * imply activity that never happened. Every day in the window is emitted,
 * zero-filled.
 */
export async function dailySeries(db: Db, { days = 30 }: { days?: number } = {}): Promise<SeriesPoint[]> {
  const span = normalizeSpan(days);
  const since = `-${span - 1} days`;

  const [viewRows, commentRows, reactionRows, publishedRows, calendar] = await Promise.all([
    db.all<{ day: string; total: number; readers: number }>(
      `SELECT viewed_on AS day, COUNT(*) AS total, COUNT(DISTINCT NULLIF(viewer_id, '')) AS readers
       FROM article_views WHERE viewed_on >= date('now', ?) GROUP BY viewed_on`,
      [since],
    ),
    db.all<{ day: string; total: number }>(
      `SELECT date(created_at) AS day, COUNT(*) AS total
       FROM comments WHERE date(created_at) >= date('now', ?) GROUP BY day`,
      [since],
    ),
    db.all<{ day: string; total: number }>(
      `SELECT date(created_at) AS day, COUNT(*) AS total
       FROM reactions WHERE date(created_at) >= date('now', ?) GROUP BY day`,
      [since],
    ),
    db.all<{ day: string; total: number }>(
      `SELECT published_at AS day, COUNT(*) AS total
       FROM articles WHERE status = 'published' AND published_at >= date('now', ?) GROUP BY day`,
      [since],
    ),
    db.all<{ value: string }>(
      `WITH RECURSIVE day(value) AS (
         SELECT date('now', ?) UNION ALL
         SELECT date(value, '+1 day') FROM day WHERE value < date('now')
       ) SELECT value FROM day`,
      [since],
    ),
  ]);

  const index = (rows: { day: string; total?: number; readers?: number }[], field: 'total' | 'readers') =>
    new Map(rows.map((row) => [row.day, Number(row[field] ?? 0)]));
  const views = index(viewRows, 'total');
  const readers = index(viewRows, 'readers');
  const comments = index(commentRows, 'total');
  const reactions = index(reactionRows, 'total');
  const published = index(publishedRows, 'total');

  return calendar.map(({ value }) => ({
    date: value,
    views: views.get(value) ?? 0,
    readers: readers.get(value) ?? 0,
    comments: comments.get(value) ?? 0,
    reactions: reactions.get(value) ?? 0,
    published: published.get(value) ?? 0,
  }));
}

export interface TrendWindow {
  current: number;
  previous: number;
  /** Percentage; null when the previous window was empty. */
  change: number | null;
}

export interface Trends {
  days: number;
  views: TrendWindow;
  comments: TrendWindow;
  reactions: TrendWindow;
  published: TrendWindow;
}

/**
 * Current window vs the window immediately before it, so a headline metric can
 * show direction rather than a bare number. Both windows are closed at both
 * ends: without the upper bound, a future-dated row would count towards "this
 * period" while falling outside the chart series covering the same period.
 */
export async function trends(db: Db, { days = 30 }: { days?: number } = {}): Promise<Trends> {
  const span = normalizeSpan(days);
  const current = `-${span - 1} days`;
  const previousStart = `-${span * 2 - 1} days`;
  const previousEnd = `-${span} days`;

  const countWindow = async (table: string, column: string, from: string, to?: string): Promise<number> =>
    to === undefined
      ? db.count(
          `SELECT COUNT(*) AS total FROM ${table} WHERE date(${column}) >= date('now', ?) AND date(${column}) <= date('now')`,
          [from],
        )
      : db.count(
          `SELECT COUNT(*) AS total FROM ${table} WHERE date(${column}) >= date('now', ?) AND date(${column}) <= date('now', ?)`,
          [from, to],
        );

  const build = (now: number, previous: number): TrendWindow => ({
    current: now,
    previous,
    change: previous > 0 ? Number((((now - previous) / previous) * 100).toFixed(1)) : null,
  });

  const [viewsNow, viewsPrev, commentsNow, commentsPrev, reactionsNow, reactionsPrev, publishedNow, publishedPrev] =
    await Promise.all([
      countWindow('article_views', 'viewed_on', current),
      countWindow('article_views', 'viewed_on', previousStart, previousEnd),
      countWindow('comments', 'created_at', current),
      countWindow('comments', 'created_at', previousStart, previousEnd),
      countWindow('reactions', 'created_at', current),
      countWindow('reactions', 'created_at', previousStart, previousEnd),
      db.count(
        "SELECT COUNT(*) AS total FROM articles WHERE status = 'published' AND published_at >= date('now', ?) AND published_at <= date('now')",
        [current],
      ),
      db.count(
        "SELECT COUNT(*) AS total FROM articles WHERE status = 'published' AND published_at >= date('now', ?) AND published_at <= date('now', ?)",
        [previousStart, previousEnd],
      ),
    ]);

  return {
    days: span,
    views: build(viewsNow, viewsPrev),
    comments: build(commentsNow, commentsPrev),
    reactions: build(reactionsNow, reactionsPrev),
    published: build(publishedNow, publishedPrev),
  };
}

export interface AuthorLeaderboardRow {
  id: number;
  slug: string;
  name: string;
  role: string;
  image: string;
  imageAlt: string;
  registeredAt: string;
  articles: number;
  published: number;
  drafts: number;
  pending: number;
  scheduled: number;
  views: number;
  reactions: number;
  comments: number;
}

/** Per-author productivity and the engagement their work earned. */
export async function authorLeaderboard(db: Db): Promise<AuthorLeaderboardRow[]> {
  const rows = await db.all<Record<string, string | number | null>>(
    `SELECT
       au.id, au.slug, au.name, au.role, au.image, au.image_alt, au.created_at,
       COUNT(DISTINCT ar.id) AS total_articles,
       COUNT(DISTINCT CASE WHEN ar.status = 'published' THEN ar.id END) AS published,
       COUNT(DISTINCT CASE WHEN ar.status = 'draft'     THEN ar.id END) AS drafts,
       COUNT(DISTINCT CASE WHEN ar.status = 'pending'   THEN ar.id END) AS pending,
       COUNT(DISTINCT CASE WHEN ar.status = 'scheduled' THEN ar.id END) AS scheduled,
       (SELECT COUNT(*) FROM article_views v
         JOIN articles a2 ON a2.slug = v.article_slug WHERE a2.author_slug = au.slug) AS views,
       (SELECT COUNT(*) FROM reactions r
         JOIN articles a3 ON a3.slug = r.article_slug WHERE a3.author_slug = au.slug) AS reactions,
       (SELECT COUNT(*) FROM comments c
         JOIN articles a4 ON a4.slug = c.article_slug WHERE a4.author_slug = au.slug) AS comments
     FROM authors au
     LEFT JOIN articles ar ON ar.author_slug = au.slug
     GROUP BY au.id
     ORDER BY published DESC, views DESC, au.name ASC`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    slug: String(row.slug ?? ''),
    name: String(row.name ?? ''),
    role: String(row.role ?? ''),
    image: String(row.image ?? ''),
    imageAlt: String(row.image_alt ?? ''),
    registeredAt: String(row.created_at ?? ''),
    articles: Number(row.total_articles ?? 0),
    published: Number(row.published ?? 0),
    drafts: Number(row.drafts ?? 0),
    pending: Number(row.pending ?? 0),
    scheduled: Number(row.scheduled ?? 0),
    views: Number(row.views ?? 0),
    reactions: Number(row.reactions ?? 0),
    comments: Number(row.comments ?? 0),
  }));
}

export interface TopArticleRow {
  slug: string;
  title: string;
  category: string;
  status: string;
  author: string;
  authorSlug: string;
  views: number;
  readers: number;
  likes: number;
  dislikes: number;
  comments: number;
}

/** Best performing articles by counted reads. */
export async function topArticles(db: Db, { limit = 8 }: { limit?: number } = {}): Promise<TopArticleRow[]> {
  const cap = Math.min(Math.max(Number(limit) || 8, 1), 50);
  const rows = await db.all<Record<string, string | number | null>>(
    `SELECT a.slug, a.title, a.category, a.status, a.author, a.author_slug,
       (SELECT COUNT(*) FROM article_views v WHERE v.article_slug = a.slug) AS views,
       (SELECT COUNT(DISTINCT NULLIF(v.viewer_id, '')) FROM article_views v WHERE v.article_slug = a.slug) AS readers,
       (SELECT COUNT(*) FROM reactions r WHERE r.article_slug = a.slug AND r.type = 'like') AS likes,
       (SELECT COUNT(*) FROM reactions r WHERE r.article_slug = a.slug AND r.type = 'dislike') AS dislikes,
       (SELECT COUNT(*) FROM comments c WHERE c.article_slug = a.slug) AS comments
     FROM articles a
     ORDER BY views DESC, likes DESC, a.published_at DESC
     LIMIT ?`,
    [cap],
  );
  return rows.map((row) => ({
    slug: String(row.slug ?? ''),
    title: String(row.title ?? ''),
    category: String(row.category ?? ''),
    status: String(row.status ?? ''),
    author: String(row.author ?? ''),
    authorSlug: String(row.author_slug ?? ''),
    views: Number(row.views ?? 0),
    readers: Number(row.readers ?? 0),
    likes: Number(row.likes ?? 0),
    dislikes: Number(row.dislikes ?? 0),
    comments: Number(row.comments ?? 0),
  }));
}

export interface CategoryBreakdownRow {
  category: string;
  articles: number;
  views: number;
}

export async function categoryBreakdown(db: Db): Promise<CategoryBreakdownRow[]> {
  const rows = await db.all<{ category: string; articles: number; views: number }>(
    `SELECT a.category,
       COUNT(*) AS articles,
       (SELECT COUNT(*) FROM article_views v
         JOIN articles a2 ON a2.slug = v.article_slug WHERE a2.category = a.category) AS views
     FROM articles a GROUP BY a.category ORDER BY views DESC, articles DESC`,
  );
  return rows.map((row) => ({
    category: row.category,
    articles: Number(row.articles),
    views: Number(row.views),
  }));
}

export interface ActivityEvent {
  type: string;
  at: string;
  title: string;
  slug: string;
  detail: string;
  body?: string;
}

/** Newest editorial and reader events, merged into one reverse-chronological feed. */
export async function recentActivity(db: Db, { limit = 12 }: { limit?: number } = {}): Promise<ActivityEvent[]> {
  const cap = Math.min(Math.max(Number(limit) || 12, 1), 50);
  const events: ActivityEvent[] = [];

  const [commentRows, reactionRows, articleRows] = await Promise.all([
    db.all<Record<string, string | null>>(
      `SELECT c.author, c.body, c.created_at, c.article_slug, a.title
       FROM comments c LEFT JOIN articles a ON a.slug = c.article_slug
       ORDER BY c.id DESC LIMIT ?`,
      [cap],
    ),
    db.all<Record<string, string | null>>(
      `SELECT r.type, r.created_at, r.article_slug, a.title
       FROM reactions r LEFT JOIN articles a ON a.slug = r.article_slug
       ORDER BY r.id DESC LIMIT ?`,
      [cap],
    ),
    db.all<Record<string, string | null>>(
      `SELECT slug, title, author, status, updated_at FROM articles
       ORDER BY datetime(updated_at) DESC LIMIT ?`,
      [cap],
    ),
  ]);

  for (const row of commentRows) {
    events.push({
      type: 'comment',
      at: String(row.created_at ?? ''),
      title: String(row.title ?? row.article_slug ?? ''),
      slug: String(row.article_slug ?? ''),
      detail: `${row.author ?? 'A reader'} commented`,
      body: String(row.body ?? '').slice(0, 140),
    });
  }
  for (const row of reactionRows) {
    events.push({
      type: row.type === 'like' ? 'like' : 'dislike',
      at: String(row.created_at ?? ''),
      title: String(row.title ?? row.article_slug ?? ''),
      slug: String(row.article_slug ?? ''),
      detail: row.type === 'like' ? 'A reader liked this' : 'A reader disliked this',
    });
  }
  for (const row of articleRows) {
    events.push({
      type: row.status === 'published' ? 'published' : 'article',
      at: String(row.updated_at ?? ''),
      title: String(row.title ?? ''),
      slug: String(row.slug ?? ''),
      detail: `${row.author ?? ''} - ${row.status ?? ''}`,
    });
  }

  return events
    .filter((event) => event.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, cap);
}

/**
 * A single cheap signature of "something changed", used by the live dashboard
 * stream to decide when to nudge connected admins to refetch.
 */
export async function activitySignature(db: Db): Promise<string> {
  const row = await db.first<Record<string, number | string | null>>(
    `SELECT
       (SELECT COUNT(*) FROM comments) AS comments,
       (SELECT COUNT(*) FROM reactions) AS reactions,
       (SELECT COUNT(*) FROM article_views) AS views,
       (SELECT COUNT(*) FROM articles) AS articles,
       (SELECT MAX(updated_at) FROM articles) AS last_update`,
  );
  return JSON.stringify(row ?? {});
}

/** Everything the dashboard renders, in a single round trip. */
export async function overview(db: Db, { days = 30 }: { days?: number } = {}) {
  const [statuses, totalArticles, likes, dislikes, views, readers, authors, comments, images] =
    await Promise.all([
      statusBreakdown(db),
      db.count('SELECT COUNT(*) AS total FROM articles'),
      db.count("SELECT COUNT(*) AS total FROM reactions WHERE type = 'like'"),
      db.count("SELECT COUNT(*) AS total FROM reactions WHERE type = 'dislike'"),
      db.count('SELECT COUNT(*) AS total FROM article_views'),
      db.count("SELECT COUNT(DISTINCT viewer_id) AS total FROM article_views WHERE viewer_id != ''"),
      db.count('SELECT COUNT(*) AS total FROM authors'),
      db.count('SELECT COUNT(*) AS total FROM comments'),
      db.count('SELECT COUNT(*) AS total FROM images'),
    ]);

  const [series, trendWindows, leaderboard, top, categoryRows, activity] = await Promise.all([
    dailySeries(db, { days }),
    trends(db, { days }),
    authorLeaderboard(db),
    topArticles(db, { limit: 8 }),
    categoryBreakdown(db),
    recentActivity(db, { limit: 12 }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      articles: totalArticles,
      published: statuses.published,
      // "Unpublished" is everything not live: drafts, scheduled, pending and
      // any legacy status. Shown as one figure so the two always add up to the
      // article total, with the individual statuses broken out below.
      unpublished: totalArticles - statuses.published,
      drafts: statuses.draft,
      scheduled: statuses.scheduled,
      pending: statuses.pending,
      otherStatus: statuses.other,
      authors,
      views,
      readers,
      likes,
      dislikes,
      reactions: likes + dislikes,
      comments,
      images,
    },
    statuses,
    trends: trendWindows,
    series,
    authors: leaderboard,
    topArticles: top,
    categories: categoryRows,
    activity,
  };
}
