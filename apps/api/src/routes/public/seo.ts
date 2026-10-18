/**
 * Routes — document rendering for the edge: SEO files and server-rendered
 * article pages.
 *
 * These endpoints mirror the legacy Express document routes (cms/server.js):
 * robots.txt and sitemap.xml are generated from live data, clean article URLs
 * are rendered from current database rows on every request, and the legacy
 * `article.html?slug=` links are redirected to the canonical clean URL.
 *
 * In production the Pages Functions (functions/articles/[slug].ts,
 * functions/robots.txt.ts, …) call these through the service binding and pass
 * the visitor's origin; the local dev-server proxies the same paths here. The
 * responses are documents, not JSON envelopes — the same bytes the legacy
 * server produced.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as articlesRepo from '../../db/repositories/articles.js';
import * as authorsRepo from '../../db/repositories/authors.js';
import * as settingsRepo from '../../db/repositories/settings.js';
import { renderArticlePage } from '../../lib/article-page.js';
import { escapeHtml } from '../../lib/markdown.js';

export const publicSeoRoutes = new Hono<AppEnv>();

const dbFrom = (c: AppContext) => createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

/**
 * The origin a document should advertise. Precedence:
 *   1. the `origin` query parameter (the Pages Function passes the visitor's
 *      real origin; a service-binding request would otherwise carry an
 *      internal host),
 *   2. SITE_URL when configured (canonical production domain),
 *   3. x-forwarded-host (the dev-server and the /api proxy set it),
 *   4. the request URL itself.
 */
export function resolveOrigin(c: AppContext): string {
  const fromQuery = c.req.query('origin');
  if (fromQuery && /^https?:\/\/[^/\s]+/i.test(fromQuery)) {
    return new URL(fromQuery).origin;
  }
  const config = c.get('config');
  if (config.siteUrl) return new URL(config.siteUrl).origin;
  const forwarded = c.req.header('x-forwarded-host');
  if (forwarded) {
    const scheme = c.req.header('x-forwarded-proto') ?? (config.isProduction ? 'https' : 'http');
    try {
      return new URL(`${scheme}://${forwarded}`).origin;
    } catch {
      /* fall through */
    }
  }
  return new URL(c.req.url).origin;
}

/**
 * Document responses bypass the JSON security headers (a `default-src 'none'`
 * CSP would break a rendered page). This applies the static-site policy from
 * `apps/web/public/_headers` so an SSR document and a static page behave the
 * same in the browser.
 */
function documentResponse(c: AppContext, body: string, contentType: string, cacheControl: string): Response {
  c.header('Content-Security-Policy', PAGE_CSP);
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Cache-Control', cacheControl);
  return c.body(body, 200, { 'Content-Type': contentType });
}

/** Kept in sync with apps/web/public/_headers (a unit test asserts parity). */
export const PAGE_CSP =
  "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'; " +
  "img-src 'self' data: https:; " +
  "script-src 'self' https://cdn.jsdelivr.net; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
  "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
  "connect-src 'self' https://cdn.jsdelivr.net; " +
  "worker-src 'self' https://cdn.jsdelivr.net blob:; " +
  "media-src 'self'";

/* --------------------------------- robots ---------------------------------- */

publicSeoRoutes.get('/seo/robots.txt', (c) => {
  const origin = resolveOrigin(c);
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /api/',
    `Sitemap: ${new URL('/sitemap.xml', `${origin}/`).href}`,
    '',
  ].join('\n');
  return documentResponse(c, body, 'text/plain; charset=utf-8', 'public, max-age=300');
});

/* -------------------------------- sitemap ---------------------------------- */

publicSeoRoutes.get('/seo/sitemap.xml', async (c) => {
  const origin = resolveOrigin(c);
  const db = dbFrom(c);
  const staticPages = [
    { path: '/', priority: '1.0', frequency: 'daily' },
    { path: '/about.html', priority: '0.7', frequency: 'monthly' },
    { path: '/contact.html', priority: '0.6', frequency: 'monthly' },
    { path: '/help_&_support.html', priority: '0.5', frequency: 'monthly' },
    { path: '/privacy_policy.html', priority: '0.4', frequency: 'yearly' },
  ];
  const urls: { loc: string; lastmod?: string; frequency: string; priority: string }[] = staticPages.map(
    (page) => ({ loc: new URL(page.path, `${origin}/`).href, ...page }),
  );

  for (const article of await articlesRepo.list(db, { status: 'published' })) {
    if (!article.body || article.externalLink) continue;
    const changed = article.updatedAt || article.date;
    const lastmod =
      changed && !Number.isNaN(new Date(changed).valueOf())
        ? new Date(changed).toISOString().slice(0, 10)
        : article.date;
    urls.push({
      loc:
        article.canonicalUrl ||
        new URL(`/articles/${encodeURIComponent(article.slug)}/`, `${origin}/`).href,
      lastmod,
      frequency: 'monthly',
      priority: article.featured ? '0.9' : '0.8',
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (url) =>
        `  <url>\n    <loc>${escapeHtml(url.loc)}</loc>${
          url.lastmod ? `\n    <lastmod>${escapeHtml(url.lastmod)}</lastmod>` : ''
        }\n    <changefreq>${url.frequency}</changefreq>\n    <priority>${url.priority}</priority>\n  </url>`,
    )
    .join('\n')}\n</urlset>\n`;
  return documentResponse(c, xml, 'application/xml; charset=utf-8', 'public, max-age=300');
});

/* --------------------------- homepage metadata ------------------------------ */

/**
 * The values the homepage Pages Function injects into the static index.html
 * (the legacy `renderHomepage`): live settings plus the derived canonical,
 * Open Graph image and JSON-LD graph.
 */
publicSeoRoutes.get('/render/home-meta', async (c) => {
  const origin = resolveOrigin(c);
  const db = dbFrom(c);
  const current = await settingsRepo.all(db);

  const canonical = new URL('/', `${origin}/`).href;
  const image = new URL('/assets/brand/page_logo.png', `${origin}/`).href;
  const title = current.siteTitle || 'Sholynk Tech';
  const description = current.siteDescription || '';
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${canonical}#organization`,
        name: 'Sholynk Technology',
        url: canonical,
        logo: image,
        founder: { '@id': new URL('/about.html#oluwashola-busari', `${origin}/`).href },
      },
      {
        '@type': 'WebSite',
        '@id': `${canonical}#website`,
        url: canonical,
        name: title,
        description,
        publisher: { '@id': `${canonical}#organization` },
      },
    ],
  };

  return c.json({
    title,
    description,
    keywords: current.siteKeywords || '',
    tagline: current.homeTagline || '',
    canonical,
    ogImage: image,
    jsonld: JSON.stringify(graph).replace(/</g, '\\u003c'),
  });
});

/* ------------------------------ article pages ------------------------------- */

function articleDestination(c: AppContext, article: { externalLink?: string | null }, origin: string): string {
  const link = String(article.externalLink || '').trim();
  if (/^https?:\/\//i.test(link)) return link;
  return new URL(link.replace(/^\/+/, ''), `${origin}/`).href;
}

/**
 * GET /render/articles/:slug — the clean article URL, rendered live from the
 * database on every request (legacy `app.get('/articles/:slug')`).
 */
publicSeoRoutes.get('/render/articles/:slug', async (c) => {
  const slug = c.req.param('slug');
  const origin = resolveOrigin(c);
  const db = dbFrom(c);

  let article = await articlesRepo.findLiveBySlug(db, slug);
  if (!article) {
    const redirect = await articlesRepo.findRedirect(db, slug);
    if (redirect) {
      return c.redirect(`/articles/${encodeURIComponent(redirect)}/`, 301);
    }
    return c.body('Article not found', 404, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (article.externalLink) {
    return c.redirect(articleDestination(c, article, origin), 302);
  }
  if (!article.body) {
    return c.body('Article not found', 404, { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  const [articles, authors] = await Promise.all([
    articlesRepo.list(db, { status: 'published' }),
    authorsRepo.list(db),
  ]);
  const html = renderArticlePage({ article, articles, authors, origin });
  if (!html) {
    return c.body('Article not found', 404, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  return documentResponse(c, html, 'text/html; charset=utf-8', 'no-cache');
});

/**
 * GET /render/legacy-article?slug= — keeps old shared links working
 * (legacy `app.get('/article.html')`): 301 to the clean route, 302 to an
 * external destination, or 404.
 */
publicSeoRoutes.get('/render/legacy-article', async (c) => {
  const slug = String(c.req.query('slug') ?? '').trim();
  const origin = resolveOrigin(c);
  if (!slug) return c.redirect('/', 302);

  const db = dbFrom(c);
  const article = await articlesRepo.findLiveBySlug(db, slug);
  if (!article) {
    return c.body('Article not found', 404, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (article.externalLink) {
    return c.redirect(articleDestination(c, article, origin), 302);
  }
  return c.redirect(`/articles/${encodeURIComponent(article.slug)}/`, 301);
});
