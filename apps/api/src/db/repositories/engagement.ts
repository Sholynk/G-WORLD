/**
 * Repository — reader engagement: like/dislike reactions and article comments.
 *
 * Ported from the legacy CMS module (cms/lib/engagement.js). Both are keyed by
 * article *slug* instead of a foreign key. A "voter" is an anonymous browser
 * generated id (the front-end `SholynkEngagement` client). It is not
 * authentication; it exists to make the one-vote-per-reader rule enforceable
 * server-side as well as in the UI, so a refresh or a second tab cannot inflate
 * the counts.
 */
import type { Db } from '../client.js';
import { badRequest } from '../../lib/errors.js';

export const MAX_AUTHOR_LENGTH = 60;
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_SLUG_LENGTH = 120;
export const MAX_VOTER_LENGTH = 64;
export const MAX_CLIENT_ID_LENGTH = 80;

export interface ReactionTallies {
  slug: string;
  likes: number;
  dislikes: number;
  mine: 'like' | 'dislike' | null;
}

export interface CommentDto {
  id: number;
  slug: string;
  author: string;
  body: string;
  clientId: string;
  createdAt: string;
}

export interface AdminCommentDto extends CommentDto {
  articleSlug: string;
  articleTitle: string;
}

export function normalizeSlug(value: unknown): string {
  const slug = String(value ?? '').trim().slice(0, MAX_SLUG_LENGTH);
  if (!slug) throw badRequest('article slug is required');
  return slug;
}

export function normalizeVoter(value: unknown): string {
  return String(value ?? '').trim().slice(0, MAX_VOTER_LENGTH);
}

/* --------------------------------- reactions ------------------------------ */

export async function tallies(db: Db, slug: string, voterId = ''): Promise<ReactionTallies> {
  const articleSlug = normalizeSlug(slug);
  const rows = await db.all<{ type: string; total: number }>(
    'SELECT type, COUNT(*) AS total FROM reactions WHERE article_slug = ? GROUP BY type',
    [articleSlug],
  );
  const counts = { like: 0, dislike: 0 };
  for (const row of rows) {
    if (row.type === 'like' || row.type === 'dislike') counts[row.type] = Number(row.total);
  }

  let mine: 'like' | 'dislike' | null = null;
  const voter = normalizeVoter(voterId);
  if (voter) {
    const row = await db.first<{ type: 'like' | 'dislike' }>(
      'SELECT type FROM reactions WHERE article_slug = ? AND voter_id = ?',
      [articleSlug, voter],
    );
    mine = row ? row.type : null;
  }
  return { slug: articleSlug, likes: counts.like, dislikes: counts.dislike, mine };
}

/**
 * Records a reader's reaction. Idempotent per (slug, voter): submitting the
 * same reaction twice removes it (an un-vote), and submitting the opposite one
 * switches sides.
 */
export async function react(
  db: Db,
  slug: string,
  input: { voterId?: string; type?: string },
): Promise<ReactionTallies> {
  const articleSlug = normalizeSlug(slug);
  const voter = normalizeVoter(input.voterId);
  const type = String(input.type ?? '');

  if (!voter) throw badRequest('voterId is required');
  if (type !== 'like' && type !== 'dislike') throw badRequest("type must be 'like' or 'dislike'");

  const existing = await db.first<{ id: number; type: string }>(
    'SELECT id, type FROM reactions WHERE article_slug = ? AND voter_id = ?',
    [articleSlug, voter],
  );

  if (!existing) {
    await db.run('INSERT INTO reactions (article_slug, voter_id, type) VALUES (?, ?, ?)', [
      articleSlug,
      voter,
      type,
    ]);
  } else if (existing.type === type) {
    await db.run('DELETE FROM reactions WHERE id = ?', [existing.id]);
  } else {
    await db.run("UPDATE reactions SET type = ?, updated_at = datetime('now') WHERE id = ?", [
      type,
      existing.id,
    ]);
  }

  return tallies(db, articleSlug, voter);
}

/* --------------------------------- comments ------------------------------- */

type CommentRow = Record<string, string | number | null> & { id: number };

function toCommentApi(row: CommentRow | null): CommentDto | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    slug: String(row.article_slug ?? ''),
    author: String(row.author ?? ''),
    body: String(row.body ?? ''),
    clientId: String(row.client_id ?? ''),
    createdAt: String(row.created_at ?? ''),
  };
}

export async function listComments(db: Db, slug: string, limit?: number): Promise<CommentDto[]> {
  const articleSlug = normalizeSlug(slug);
  const rows = Number.isFinite(limit)
    ? await db.all<CommentRow>(
        'SELECT * FROM comments WHERE article_slug = ? ORDER BY id DESC LIMIT ?',
        [articleSlug, Number(limit)],
      )
    : await db.all<CommentRow>('SELECT * FROM comments WHERE article_slug = ? ORDER BY id DESC', [
        articleSlug,
      ]);
  return rows.map((row) => toCommentApi(row)!);
}

/** Full comment history across every article, newest first — the admin record. */
/** How many comments exist (for the author, scoped to their articles). */
export async function countAllComments(db: Db, ownerUserId?: string): Promise<number> {
  const sql = `SELECT COUNT(*) AS total FROM comments c
    LEFT JOIN articles a ON a.slug = c.article_slug
    ${ownerUserId ? 'WHERE a.owner_user_id = ?' : ''}`;
  return db.count(sql, ownerUserId ? [ownerUserId] : []);
}

export async function listAllComments(db: Db, limit?: number, ownerUserId?: string): Promise<AdminCommentDto[]> {
  const sql = `
    SELECT c.*, a.title AS article_title
    FROM comments c
    LEFT JOIN articles a ON a.slug = c.article_slug
    ${ownerUserId ? 'WHERE a.owner_user_id = ?' : ''}
    ORDER BY c.id DESC
  `;
  const rows = Number.isFinite(limit)
    ? await db.all<CommentRow>(`${sql} LIMIT ?`, [...(ownerUserId ? [ownerUserId] : []), Number(limit)])
    : await db.all<CommentRow>(sql, ownerUserId ? [ownerUserId] : []);
  return rows.map((row) => ({
    id: Number(row.id),
    slug: String(row.article_slug ?? ''),
    articleSlug: String(row.article_slug ?? ''),
    articleTitle: String(row.article_title ?? row.article_slug ?? ''),
    author: String(row.author ?? ''),
    body: String(row.body ?? ''),
    clientId: String(row.client_id ?? ''),
    createdAt: String(row.created_at ?? ''),
  }));
}

export async function countComments(db: Db, slug: string): Promise<number> {
  return db.count('SELECT COUNT(*) AS total FROM comments WHERE article_slug = ?', [normalizeSlug(slug)]);
}

/**
 * Adds a comment. A submission carries a client-generated id so a retried
 * request (timeout or double-tab) returns the original comment instead of
 * creating a duplicate.
 */
export async function addComment(
  db: Db,
  slug: string,
  input: { author?: string; body?: string; voterId?: string; clientId?: string },
): Promise<CommentDto> {
  const articleSlug = normalizeSlug(slug);
  const cleanAuthor = String(input.author ?? '').trim().replace(/\s+/g, ' ');
  const cleanBody = String(input.body ?? '').trim();
  const cleanClientId = String(input.clientId ?? '').trim().slice(0, MAX_CLIENT_ID_LENGTH);

  if (!cleanAuthor) throw badRequest('name is required');
  if (cleanAuthor.length > MAX_AUTHOR_LENGTH) {
    throw badRequest(`name must be ${MAX_AUTHOR_LENGTH} characters or fewer`);
  }
  if (!cleanBody) throw badRequest('comment is required');
  if (cleanBody.length > MAX_COMMENT_LENGTH) {
    throw badRequest(`comment must be ${MAX_COMMENT_LENGTH} characters or fewer`);
  }

  if (cleanClientId) {
    const existing = await db.first<CommentRow>(
      'SELECT * FROM comments WHERE article_slug = ? AND client_id = ?',
      [articleSlug, cleanClientId],
    );
    if (existing) return toCommentApi(existing)!;
  }

  const result = await db.run(
    'INSERT INTO comments (article_slug, author, body, voter_id, client_id) VALUES (?, ?, ?, ?, ?)',
    [articleSlug, cleanAuthor, cleanBody, normalizeVoter(input.voterId), cleanClientId],
  );
  const row = await db.first<CommentRow>('SELECT * FROM comments WHERE id = ?', [
    Number(result.lastRowId ?? 0),
  ]);
  const dto = toCommentApi(row);
  if (!dto) throw badRequest('comment could not be stored');
  return dto;
}

export async function removeComment(db: Db, id: number, ownerUserId?: string): Promise<boolean> {
  const changes = await db.changes(`DELETE FROM comments WHERE id = ?${ownerUserId ? ' AND article_slug IN (SELECT slug FROM articles WHERE owner_user_id = ?)' : ''}`, [Number(id), ...(ownerUserId ? [ownerUserId] : [])]);
  return changes > 0;
}

/** Everything a page needs for its engagement widgets, in one round trip. */
export async function summary(
  db: Db,
  slug: string,
  voterId = '',
): Promise<{ reactions: ReactionTallies; comments: CommentDto[] }> {
  const articleSlug = normalizeSlug(slug);
  return {
    reactions: await tallies(db, articleSlug, voterId),
    comments: await listComments(db, articleSlug),
  };
}
