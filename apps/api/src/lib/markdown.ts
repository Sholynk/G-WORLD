/**
 * Sholynk Tech — Markdown rendering and sanitisation for article bodies.
 *
 * Ported 1:1 from the legacy CMS renderer (cms/lib/article-page.js):
 *   1. `marked` parses GitHub-flavoured Markdown,
 *   2. every `<h2>` gets a stable, deduplicated `id` (the in-page navigation,
 *      the table of contents and `#hash` links all depend on these),
 *   3. `sanitize-html` strips everything that is not on the allow-list — the
 *      body is authored content but must never become an XSS vector,
 *   4. links and images are rewritten for the clean article URL depth
 *      (`/articles/<slug>/` is two segments below the site root) and external
 *      links get `target="_blank" rel="noopener noreferrer"`,
 *   5. known local images are stamped with their intrinsic width/height so the
 *      layout does not reflow while a long article loads (this is what keeps
 *      TOC anchors landing on the right section).
 */
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import IMAGE_DIMENSIONS from './image-dimensions.json';

/**
 * Clean article URLs live at <site>/articles/<slug>/, two path segments below
 * the site root. Local links therefore use "../../" so browser navigation and
 * assets resolve correctly without assuming a particular hostname.
 */
export const SITE_ROOT_PREFIX = '../../';

export function escapeHtml(value: string = ''): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function headingSlug(value: string = ''): string {
  return (
    String(value)
      .replace(/<[^>]*>/g, '')
      .replace(/&[^;]+;/g, ' ')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-') || 'section'
  );
}

export function articlePageUrl(value: string = ''): string {
  const reference = String(value).trim();
  if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(reference)) {
    return reference;
  }
  try {
    const parsed = new URL(reference, 'https://article-content.invalid/');
    const pathname = parsed.pathname.replace(/^\/+/, '');
    return `${SITE_ROOT_PREFIX}${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return reference;
  }
}

export function siteUrl(pathname: string = '/', origin: string): string {
  const relative = `/${String(pathname).replace(/^\/+/, '')}`;
  return new URL(relative, `${origin}/`).href;
}

export function absoluteUrl(value: string = '', origin: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  const reference = String(value).trim();
  const parsed = new URL(reference.replace(/^\/+/, ''), 'https://site.invalid/');
  const relative = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return new URL(relative, `${origin}/`).href;
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Intrinsic pixel size for a deployed site asset, or null (remote/unknown). */
export function intrinsicSize(src: string = ''): { width: number; height: number } | null {
  const reference = String(src).trim();
  if (!reference || /^(?:https?:|data:|\/\/)/i.test(reference)) return null;

  // Markdown authors write paths relative to the site root, sometimes
  // URL-encoded (e.g. "assets%2Fcards%2Fai%2Farticle_card_09.jpg").
  let relative = reference.split(/[?#]/, 1)[0]!.replace(/^(?:(?:\.\.?)\/)+/, '').replace(/^\/+/, '');
  try {
    relative = decodeURIComponent(relative);
  } catch {
    // Malformed escape sequence: fall back to the raw path.
  }
  // Article pages reference assets two levels up ("../../assets/…"); the map is
  // keyed from the site root, so strip the article-page prefix as well.
  relative = relative.replace(/^(?:\.\.\/)+/, '');

  const entry = (IMAGE_DIMENSIONS as unknown as Record<string, [number, number]>)[relative];
  if (!entry) return null;
  return { width: entry[0], height: entry[1] };
}

/**
 * Stamp intrinsic width/height onto every body image that lacks them.
 *
 * Without these attributes an image occupies zero height until it decodes, so
 * the page reflows as each one arrives. That shifts every heading below it and
 * is what makes in-page navigation land past the section it aimed at.
 * Declaring the real dimensions lets the browser reserve the space up front,
 * so the layout is stable from first paint and anchors resolve correctly even
 * with JavaScript disabled.
 */
export function addIntrinsicImageSizes(html: string = ''): string {
  const replacements = new Map<string, string>();

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    if (replacements.has(tag)) continue;
    if (/\bwidth\s*=/i.test(tag) && /\bheight\s*=/i.test(tag)) continue;
    const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (!src) continue;
    const size = intrinsicSize(src);
    if (!size) continue;
    replacements.set(tag, tag.replace(/\s*\/?>$/, ` width="${size.width}" height="${size.height}" />`));
  }

  if (!replacements.size) return html;
  return html.replace(/<img\b[^>]*>/gi, (tag) => replacements.get(tag) ?? tag);
}

/**
 * Markdown → sanitised HTML with stable `<h2>` ids, exactly like the legacy
 * renderer (the table of contents is built from those ids).
 */
export function renderMarkdown(markdown: string = ''): string {
  const raw = marked.parse(markdown, { gfm: true, async: false }) as string;
  const usedIds = new Set<string>();
  const withIds = raw.replace(/<h2>([\s\S]*?)<\/h2>/g, (_match, contents: string) => {
    const base = headingSlug(contents);
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    return `<h2 id="${id}">${contents}</h2>`;
  });

  return sanitizeHtml(withIds, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'figure', 'figcaption']),
    allowedAttributes: {
      '*': ['id', 'class'],
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
      code: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a(tagName, attribs) {
        const href = articlePageUrl(String(attribs.href ?? ''));
        const localised = href ? { ...attribs, href } : attribs;
        const external = /^(?:https?:)?\/\//i.test(href);
        return {
          tagName,
          attribs: external
            ? { ...localised, target: '_blank', rel: 'noopener noreferrer' }
            : localised,
        };
      },
      img(tagName, attribs) {
        let src = String(attribs.src ?? '');
        if (src && !/^(?:https?:|data:|\/\/)/i.test(src)) src = articlePageUrl(src);
        return {
          tagName,
          attribs: { ...attribs, src, alt: attribs.alt ?? '', loading: 'lazy', decoding: 'async' },
        };
      },
    },
  });
}
