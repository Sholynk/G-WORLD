/**
 * Text helpers, slug generation and identifiers.
 *
 * The slugify rules are a compatibility contract: every seeded slug, redirect
 * and reader bookmark was produced by the legacy CMS slugify, so these tests
 * pin the exact behaviour (NFKD, strip non-alphanumerics, dash-join, 80 chars)
 * rather than a generic "looks like a slug" notion.
 *
 * escapeHtml is a security boundary: the SSR renderer trusts it for every
 * database string placed into the article document.
 */
import { describe, expect, it } from 'vitest';
import { slugify, isValidSlug, uniqueSlug } from '../../apps/api/src/lib/slug.js';
import {
  escapeHtml,
  excerpt,
  normalizeSearchTerm,
  readingMinutes,
  truncate,
  wordCount,
} from '../../apps/api/src/lib/text.js';
import { CODE_ALPHABET, looksLikeId, newId, randomHex, requestId, ulid } from '../../apps/api/src/lib/ids.js';

describe('slugify (legacy-compatible)', () => {
  it('lowercases, dash-joins and strips punctuation', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('Web3 and the Future of the Internet!')).toBe('web3-and-the-future-of-the-internet');
  });

  it('matches the seeded hero slug byte-for-byte', () => {
    expect(slugify('Mastering the Art of Coding: 10 key areas every developer should focus on')).toBe(
      'mastering-the-art-of-coding-10-key-areas-every-developer-should-focus-on',
    );
  });

  it('folds diacritics away (NFKD)', () => {
    expect(slugify('Crème brûlée & Web3')).toBe('creme-brulee-web3');
  });

  it('collapses dash runs and caps the length at 80', () => {
    expect(slugify('a -- b   c')).toBe('a-b-c');
    expect(slugify('word '.repeat(40)).length).toBeLessThanOrEqual(80);
  });

  it('returns an empty string for empty input (uniqueSlug falls back)', async () => {
    expect(slugify('')).toBe('');
    const slug = await uniqueSlug('', async () => false);
    expect(slug).toMatch(/^article-\d+$/);
  });

  it('validates slugs the way the API boundary does', () => {
    expect(isValidSlug('the-rise-of-esports')).toBe(true);
    expect(isValidSlug('Bad Slug')).toBe(false);
    expect(isValidSlug('-leading')).toBe(false);
  });
});

describe('uniqueSlug', () => {
  it('appends deterministic suffixes until the check passes', async () => {
    const taken = new Set(['story', 'story-2']);
    const slug = await uniqueSlug('story', async (candidate) => taken.has(candidate));
    expect(slug).toBe('story-3');
  });

  it('returns the base immediately when it is free', async () => {
    expect(await uniqueSlug('free', async () => false)).toBe('free');
  });

  it('terminates even when everything collides', async () => {
    const slug = await uniqueSlug('x', async () => true);
    // After 100 deterministic suffixes all collide, a time-based base36 tail
    // guarantees termination (a Worker must not spin forever).
    expect(slug).toMatch(/^x-[0-9a-z]+$/);
    expect(slug.startsWith('x-2')).toBe(false);
  });
});

describe('text helpers', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<script>"a" & 'b'</script>`)).toBe(
      '&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;',
    );
  });

  it('counts words and derives the legacy reading time (200 wpm)', () => {
    expect(wordCount('one two  three\nfour')).toBe(4);
    expect(readingMinutes('word '.repeat(400))).toBe(2);
    expect(readingMinutes('short')).toBe(1);
    expect(readingMinutes('')).toBe(1); // never below one minute, like the legacy estimator
  });

  it('truncates with an ellipsis only when needed', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello world', 8)).toBe('hello w…');
  });

  it('strips markdown noise for excerpts', () => {
    expect(excerpt('## Heading\n\nSome **bold** text with [a link](https://x.dev)', 120)).toBe(
      'Heading Some bold text with a link',
    );
  });

  it('normalises search terms defensively', () => {
    expect(normalizeSearchTerm('  %AI_  trends ')).toBe('AI trends');
    expect(normalizeSearchTerm('a')).toBeNull();
    expect(normalizeSearchTerm(null)).toBeNull();
  });
});

describe('identifiers', () => {
  it('generates ULID-shaped ids that sort chronologically', () => {
    const a = ulid(Date.now() - 1000);
    const b = ulid();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
  });

  it('prefixes ids and validates the shape', () => {
    const id = newId('usr');
    expect(id).toMatch(/^usr_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(looksLikeId(id, 'usr')).toBe(true);
    expect(looksLikeId(id, 'ses')).toBe(false);
    expect(looksLikeId('usr_not-a-ulid')).toBe(false);
  });

  it('never uses ambiguous characters in human codes', () => {
    for (const banned of ['0', 'O', '1', 'I', 'L']) {
      expect(CODE_ALPHABET).not.toContain(banned);
    }
  });

  it('produces request ids and random hex of the documented shapes', () => {
    expect(requestId()).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(randomHex(8)).toMatch(/^[0-9a-f]{16}$/);
    expect(randomHex(6)).toMatch(/^[0-9a-f]{12}$/);
  });
});
