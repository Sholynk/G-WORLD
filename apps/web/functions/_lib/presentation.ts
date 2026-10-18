/**
 * Handler factories for the document routes.
 *
 * Each Pages Function file is a two-liner that delegates here, so the
 * fetch-inject-respond logic exists once and every page behaves identically.
 */
import {
  apiFetch,
  applyOriginMetadata,
  asset,
  htmlResponse,
  injectHomepage,
  siteOrigin,
  type Env,
  type HomeMeta,
  type PagesContext,
} from './env';

/**
 * Presentation pages (about/contact/help/privacy): static documents whose
 * canonical + Open Graph URLs are rewritten to the origin actually serving
 * them, exactly like the legacy Express server did. When the API is
 * unreachable the page still ships — only the metadata stays relative.
 */
export function presentationPage(assetPath: string, canonicalPath: string) {
  return async (context: PagesContext): Promise<Response> => {
    const { request, env } = context;
    const staticResponse = await asset(env, request, assetPath);
    if (!staticResponse) return new Response('Not found', { status: 404 });
    if (!staticResponse.ok) return staticResponse;

    const origin = siteOrigin(env, request);
    let html = await staticResponse.text();
    html = applyOriginMetadata(html, new URL(canonicalPath, `${origin}/`).href);
    return htmlResponse(html, staticResponse);
  };
}

/** The homepage: static shell + live settings injected from the database. */
export async function homepage(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const staticResponse = await asset(env, request, '/index.html');
  if (!staticResponse) return new Response('Not found', { status: 404 });
  if (!staticResponse.ok) return staticResponse;

  const origin = siteOrigin(env, request);
  let html = await staticResponse.text();

  const metaResponse = await apiFetch(
    env,
    request,
    '/api/v1/render/home-meta',
    `?origin=${encodeURIComponent(origin)}`,
  );
  if (metaResponse?.ok) {
    try {
      const meta = (await metaResponse.json()) as HomeMeta;
      html = injectHomepage(html, meta);
      return htmlResponse(html, staticResponse);
    } catch {
      /* fall through to the origin-only injection below */
    }
  }

  // Without the API the checked-in copy still gets correct canonical URLs; the
  // homepage script also applies live settings client-side when it can.
  html = applyOriginMetadata(html, new URL('/', `${origin}/`).href);
  return htmlResponse(html, staticResponse);
}

/**
 * Server-rendered documents produced entirely by the API worker (article
 * pages, legacy redirects, robots.txt, sitemap.xml): forward and pass the
 * response through untouched — status, Location and Content-Type included.
 */
export function proxiedDocument(
  buildPath: (context: PagesContext, origin: string) => { pathname: string; search: string },
  fallback: (context: PagesContext) => Response,
) {
  return async (context: PagesContext): Promise<Response> => {
    const { request, env } = context;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }
    const origin = siteOrigin(env, request);
    const { pathname, search } = buildPath(context, origin);
    const upstream = await apiFetch(env, request, pathname, search);
    if (!upstream) return fallback(context);
    return upstream;
  };
}

/** Standard "the content service is down" document response. */
export function serviceUnavailable(message: string, contentType = 'text/plain; charset=utf-8'): Response {
  return new Response(message, {
    status: 503,
    headers: { 'content-type': contentType, 'cache-control': 'no-store' },
  });
}

export { siteOrigin, apiFetch, asset, applyOriginMetadata, escapeHtml } from './env';
export type { Env, PagesContext };
