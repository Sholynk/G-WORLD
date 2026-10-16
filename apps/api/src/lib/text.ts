/**
 * G WORLD — safe text handling for authored lesson content.
 *
 * Lesson content is stored as Markdown-ish text and rendered server-side or in
 * the browser. Because the input is authored by administrators but displayed to
 * students, the renderer escapes HTML *first* and only then applies formatting.
 * That ordering makes stored XSS impossible even if a malicious payload is
 * pasted into the editor, and it means the frontend can safely use innerHTML on
 * the renderer's output.
 *
 * Supported syntax (a deliberate subset — no raw HTML, no scripts):
 *   # / ## / ###      headings
 *   - or *            bullet lists
 *   1.                numbered lists
 *   >                 blockquote
 *   **bold**  *italic*  `code`
 *   [label](https://…)  links (https or site-relative only)
 *   ---               horizontal rule
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Strips HTML/Markdown noise for meta descriptions and list previews. */
export function excerpt(value: string | null | undefined, maxLength = 160): string {
  if (!value) return '';
  const plain = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function renderInline(escaped: string): string {
  return escaped
    // links: only https:// or site-relative targets survive
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+|\/[^\s)]*)\)/g, (_match, label: string, href: string) => {
      return `<a href="${href}" rel="noopener noreferrer"${href.startsWith('http') ? ' target="_blank"' : ''}>${label}</a>`;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

/** Renders Markdown-ish content to safe HTML. */
export function renderMarkdown(input: string | null | undefined): string {
  if (!input) return '';
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${renderInline(escapeHtml(paragraph.join(' ')))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]!.trim()))}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      closeList();
      out.push('<hr>');
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flushParagraph();
      closeList();
      out.push(`<blockquote>${renderInline(escapeHtml(quote[1]!.trim()))}</blockquote>`);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${renderInline(escapeHtml(bullet[1]!.trim()))}</li>`);
      continue;
    }

    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${renderInline(escapeHtml(ordered[1]!.trim()))}</li>`);
      continue;
    }

    closeList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();
  return out.join('\n');
}

/** Word count for reading-time estimates (lessons, articles). */
export function wordCount(value: string | null | undefined): number {
  if (!value) return 0;
  return value.split(/\s+/).filter(Boolean).length;
}

export function readingMinutes(value: string | null | undefined): number {
  return Math.max(1, Math.round(wordCount(value) / 200));
}

/** Normalises a search term for the LIKE-based catalog search. */
export function normalizeSearchTerm(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2) return null;
  return cleaned.slice(0, 120);
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
