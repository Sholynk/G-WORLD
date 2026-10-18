/**
 * Pages Function — robots.txt generated from live configuration. Falls back to
 * a correct static policy at the edge when the API is unreachable, so crawlers
 * are never served an error page as robots.txt.
 */
import { proxiedDocument, siteOrigin } from './_lib/presentation';

export const onRequest = proxiedDocument(
  (_context, origin) => ({
    pathname: '/api/v1/seo/robots.txt',
    search: `?origin=${encodeURIComponent(origin)}`,
  }),
  (context) => {
    const origin = siteOrigin(context.env, context.request);
    const body = [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin/',
      'Disallow: /api/',
      `Sitemap: ${new URL('/sitemap.xml', `${origin}/`).href}`,
      '',
    ].join('\n');
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=60' },
    });
  },
);
