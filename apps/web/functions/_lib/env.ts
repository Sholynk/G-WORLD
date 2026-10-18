/**
 * Shared helpers for the Sholynk Tech Pages Functions.
 *
 * Files under `functions/_lib` are excluded from routing by the underscore
 * convention; every document function imports from here so the API-proxying,
 * origin resolution and metadata-injection rules live in exactly one place.
 *
 * Deliberately dependency-free (no npm imports): Pages compiles functions with
 * esbuild against the runtime Web API surface only.
 */

export interface ApiBinding {
  fetch: (request: Request) => Promise<Response>;
}

export interface AssetsBinding {
  fetch: (request: Request | string) => Promise<Response>;
}

export interface Env {
  /** Service binding to the API worker (preferred; see wrangler.toml). */
  API?: ApiBinding;
  /** Absolute origin of the API worker (fallback for `wrangler pages dev`). */
  API_ORIGIN?: string;
  /** Canonical public origin; empty means "derive from the request". */
  SITE_URL?: string;
  /** Static asset fetcher injected by Pages. */
  ASSETS: AssetsBinding;
}

export interface PagesContext {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
  params: Record<string, string>;
}

/** The origin documents should advertise: SITE_URL when set, else the request. */
export function siteOrigin(env: Env, request: Request): string {
  const configured = String(env.SITE_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall through to the request origin */
    }
  }
  return new URL(request.url).origin;
}

/** Builds the upstream API URL, or null when API_ORIGIN is unusable. */
function upstreamUrl(env: Env, pathname: string, search: string): URL | null {
  const origin = (env.API_ORIGIN ?? '').replace(/\/+$/, '');
  if (origin) {
    try {
      const url = new URL(`${origin}${pathname}${search}`);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  }
  // With a service binding the hostname never leaves the account.
  return env.API ? new URL(`https://api.internal${pathname}${search}`) : null;
}

/**
 * Calls the API worker and returns its response, or null when the API is not
 * configured/reachable. Callers decide the degradation (static fallback, 502…).
 */
export async function apiFetch(
  env: Env,
  request: Request,
  pathname: string,
  search = '',
): Promise<Response | null> {
  const target = upstreamUrl(env, pathname, search);
  if (!target) return null;

  const headers = new Headers();
  headers.set('accept', 'application/json');
  headers.set('x-forwarded-host', new URL(request.url).host);
  headers.set('x-forwarded-proto', new URL(request.url).protocol.replace(':', ''));

  try {
    return env.API
      ? await env.API.fetch(new Request(target, { method: 'GET', headers }))
      : await fetch(new Request(target, { method: 'GET', headers }));
  } catch {
    return null;
  }
}

/** Fetches a static asset through the Pages ASSETS binding. */
export async function asset(env: Env, request: Request, path: string): Promise<Response | null> {
  try {
    const url = new URL(path, new URL(request.url).origin);
    return await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Metadata injection — ported from the legacy Express server (cms/server.js)  */
/* -------------------------------------------------------------------------- */

export function escapeHtml(value: string = ''): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replaceMeta(html: string, attribute: string, key: string, content: string): string {
  const safeKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<meta\\b(?=[^>]*\\b${attribute}="${safeKey}")[^>]*>`, 'i');
  return html.replace(pattern, `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`);
}

/**
 * Canonical and social URLs must describe the origin the request actually
 * arrived on, not the checked-in placeholder. Presentation pages ship relative
 * values so they keep working from any directory; this rewrites them to the
 * live origin exactly as the article renderer and sitemap do.
 */
export function applyOriginMetadata(html: string, canonical: string): string {
  let output = html.replace(
    /<link\s+rel="canonical"[^>]*>/i,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
  );
  output = output.replace(
    /<meta\b[^>]*\bproperty="og:url"[^>]*>/i,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
  );
  output = output.replace(/<meta\b[^>]*\bproperty="og:image"[^>]*>/i, (tag) => {
    const raw = tag.match(/\bcontent="([^"]*)"/i)?.[1] || '';
    let absolute = raw;
    try {
      absolute = new URL(raw, canonical).href;
    } catch {
      absolute = raw;
    }
    const id = tag.match(/\bid="([^"]*)"/i)?.[1];
    const idAttribute = id ? ` id="${escapeHtml(id)}"` : '';
    return `<meta property="og:image" content="${escapeHtml(absolute)}"${idAttribute} />`;
  });
  return output;
}

export interface HomeMeta {
  title: string;
  description: string;
  keywords: string;
  tagline: string;
  canonical: string;
  ogImage: string;
  jsonld: string;
}

/**
 * The legacy `renderHomepage`: live settings from the database replace the
 * checked-in placeholders (title, description, keywords, Open Graph tags,
 * JSON-LD graph and the homepage tagline).
 */
export function injectHomepage(html: string, meta: HomeMeta): string {
  let output = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`);
  output = replaceMeta(output, 'name', 'description', meta.description);
  output = replaceMeta(output, 'name', 'keywords', meta.keywords);
  output = replaceMeta(output, 'property', 'og:title', meta.title);
  output = replaceMeta(output, 'property', 'og:description', meta.description);
  output = applyOriginMetadata(output, meta.canonical);
  output = output.replace(
    /<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/i,
    `<script type="application/ld+json">${meta.jsonld.replace(/</g, '\\u003c')}</script>`,
  );
  if (meta.tagline) {
    output = output.replace(
      /(<h2\s+id="discover-title">)[\s\S]*?(<\/h2>)/i,
      `$1${escapeHtml(meta.tagline)}$2`,
    );
  }
  return output;
}

/** Rebuilds an HTML response from mutated text, dropping stale length headers. */
export function htmlResponse(html: string, base?: Response): Response {
  const headers = new Headers(base?.headers);
  headers.delete('content-length');
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-cache');
  return new Response(html, { status: base?.status ?? 200, headers });
}
