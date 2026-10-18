/**
 * Sholynk Tech — safe text helpers.
 *
 * Article bodies are rendered by lib/markdown.ts (marked + sanitize-html, the
 * legacy CMS pipeline). The helpers here are for previews, search terms and
 * reading-time estimates.
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

/** Word count for reading-time estimates (lessons, articles). */
export function wordCount(value: string | null | undefined): number {
  if (!value) return 0;
  return value.split(/\s+/).filter(Boolean).length;
}

export function readingMinutes(value: string | null | undefined): number {
  return Math.max(1, Math.round(wordCount(value) / 200));
}

/** Normalises a search term for the LIKE-based article search. */
export function normalizeSearchTerm(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2) return null;
  return cleaned.slice(0, 120);
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
