/**
 * Pages Function — sitemap.xml generated from live article rows. Falls back to
 * the static pages only when the API is unreachable.
 */
import { proxiedDocument, siteOrigin } from './_lib/presentation';

export const onRequest = proxiedDocument(
  (_context, origin) => ({
    pathname: '/api/v1/seo/sitemap.xml',
    search: `?origin=${encodeURIComponent(origin)}`,
  }),
  (context) => {
    const origin = siteOrigin(context.env, context.request);
    const pages = ['/', '/about.html', '/contact.html', '/help_&_support.html', '/privacy_policy.html'];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
      .map((page) => `  <url>\n    <loc>${new URL(page, `${origin}/`).href.replace(/&/g, '&amp;')}</loc>\n  </url>`)
      .join('\n')}\n</urlset>\n`;
    return new Response(xml, {
      status: 200,
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=60' },
    });
  },
);
