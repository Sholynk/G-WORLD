/**
 * Content rendering, slugs and identifier formats.
 *
 * The renderer runs on administrator-authored Markdown that is displayed to
 * students, so the escaping tests here are a security boundary, not a style
 * preference. The identifier tests lock in the formats printed on certificates
 * and encoded into QR images.
 */
import { describe, expect, it } from 'vitest';
import { escapeHtml, excerpt, normalizeSearchTerm, readingMinutes, renderMarkdown, truncate, wordCount } from '../../apps/api/src/lib/text.js';
import { isValidSlug, slugCandidates, slugify } from '../../apps/api/src/lib/slug.js';
import {
  CODE_ALPHABET,
  ID_PREFIXES,
  certificateNumber,
  formatStudentNumber,
  looksLikeId,
  newId,
  qrCode,
  studentNumber,
  ulid,
  verificationCode,
} from '../../apps/api/src/lib/ids.js';

describe('HTML escaping', () => {
  it('escapes the characters that matter', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});

describe('markdown rendering is safe by construction', () => {
  it('escapes a script tag instead of emitting it', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes an image with an onerror handler', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('refuses a javascript: link but keeps https and site-relative ones', () => {
    const bad = renderMarkdown('[click](javascript:alert(1))');
    expect(bad).not.toContain('href="javascript');
    expect(bad).not.toContain('<a href="javascript');

    expect(renderMarkdown('[docs](https://example.com/x)')).toContain('href="https://example.com/x"');
    expect(renderMarkdown('[home](/index.html)')).toContain('href="/index.html"');
  });

  it('renders the documented syntax', () => {
    expect(renderMarkdown('## Heading')).toContain('<h2');
    expect(renderMarkdown('- one\n- two')).toContain('<ul');
    expect(renderMarkdown('- one\n- two')).toContain('<li>');
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('`code`')).toContain('<code>code</code>');
  });

  it('handles empty input without throwing', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
  });
});

describe('excerpts and measurement', () => {
  it('strips markup for previews', () => {
    expect(excerpt('## **Bold** heading with `code`')).toBe('Bold heading with code');
  });

  it('truncates with a single ellipsis at the limit', () => {
    const text = excerpt('a'.repeat(300), 160);
    expect(text).toHaveLength(160);
    expect(text.endsWith('…')).toBe(true);
  });

  it('returns an empty string when there is nothing to say', () => {
    expect(excerpt(null)).toBe('');
    expect(excerpt('')).toBe('');
  });

  it('counts words and estimates reading time with a one-minute floor', () => {
    expect(wordCount('one two   three')).toBe(3);
    expect(wordCount('')).toBe(0);
    expect(readingMinutes('short')).toBe(1);
    expect(readingMinutes(Array.from({ length: 600 }, () => 'word').join(' '))).toBe(3);
  });

  it('truncates plainly without adding markup', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });

  it('neutralises LIKE wildcards in search terms', () => {
    expect(normalizeSearchTerm('  html  ')).toBe('html');
    expect(normalizeSearchTerm('100%')).toBe('100');
    expect(normalizeSearchTerm('a')).toBeNull(); // too short to be useful
    expect(normalizeSearchTerm('')).toBeNull();
    expect(normalizeSearchTerm(null)).toBeNull();
  });
});

describe('slugs', () => {
  it('produces lowercase, hyphenated, URL-safe slugs', () => {
    expect(slugify('HTML & CSS: Foundations!')).toBe('html-css-foundations');
    expect(slugify('  Multiple   spaces  ')).toBe('multiple-spaces');
    expect(slugify('Café Études')).toBe('cafe-etudes');
  });

  it('caps the length and never ends on a hyphen', () => {
    const slug = slugify('a'.repeat(120), 20);
    expect(slug.length).toBeLessThanOrEqual(20);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('validates what it produces and offers fallbacks on collision', () => {
    expect(isValidSlug('html-and-css')).toBe(true);
    expect(isValidSlug('Html And CSS')).toBe(false);
    expect(isValidSlug('-leading')).toBe(false);

    const candidates = slugCandidates('html-and-css', 5);
    expect(candidates[0]).toBe('html-and-css');
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates.length).toBeGreaterThan(1);
  });
});

describe('identifiers', () => {
  it('builds prefixed, chronologically sortable ids', () => {
    const id = newId('usr', Date.UTC(2026, 0, 1));
    expect(id).toMatch(/^usr_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(looksLikeId(id, 'usr')).toBe(true);
    expect(looksLikeId(id, 'crs')).toBe(false);
    expect(looksLikeId('usr_short')).toBe(false);
  });

  it('rejects an invalid prefix instead of writing a bad row', () => {
    expect(() => newId('USR')).toThrow(RangeError);
    expect(() => newId('a')).toThrow(RangeError);
    expect(() => newId('has space')).toThrow(RangeError);
  });

  it('orders ids generated later after ids generated earlier', () => {
    expect(ulid(1_700_000_000_000) < ulid(1_700_000_001_000)).toBe(true);
    expect(ulid(0)).toMatch(/^0{10}[0-9A-HJKMNP-TV-Z]{16}$/);
  });

  it('formats human-facing codes with an unambiguous alphabet', () => {
    const code = verificationCode();
    const allowed = `[${CODE_ALPHABET}]`;
    expect(code).toMatch(new RegExp(`^${allowed}{4}-${allowed}{4}-${allowed}{4}$`));
    expect(code).not.toMatch(/[0O1IL]/);

    expect(studentNumber(2026)).toMatch(new RegExp(`^GW-2026-${allowed}{6}$`));
    expect(certificateNumber(2026)).toMatch(new RegExp(`^GW-CERT-2026-${allowed}{6}$`));
    expect(formatStudentNumber(2026, 'A1B2C3')).toBe('GW-2026-A1B2C3');
    expect(qrCode('student')).toMatch(new RegExp(`^GW-STUDENT-${allowed}{10}$`));
    expect(qrCode('cert')).toMatch(new RegExp(`^GW-CERT-${allowed}{10}$`));
  });

  it('never repeats a generated code', () => {
    expect(new Set(Array.from({ length: 500 }, () => verificationCode())).size).toBe(500);
  });

  it('exposes every id prefix used by the schema', () => {
    for (const [name, prefix] of Object.entries(ID_PREFIXES)) {
      expect(typeof prefix).toBe('string');
      expect(prefix.length).toBeGreaterThan(1);
      expect(name).toBeTruthy();
      expect(() => newId(prefix)).not.toThrow();
    }
  });
});
