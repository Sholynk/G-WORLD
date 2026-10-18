/**
 * Shared handler for the clean article URLs: `/articles/<slug>` and
 * `/articles/<slug>/`. The document is rendered by the API worker from live
 * database rows (see apps/api/src/routes/public/seo.ts); this function only
 * forwards the visitor's origin and passes the response through — HTML,
 * 301/302 redirect or 404 included.
 */
import { proxiedDocument, serviceUnavailable } from './presentation';
import type { PagesContext } from './env';

export const articlePageHandler = (context: PagesContext): Promise<Response> =>
  proxiedDocument(
    (ctx, origin) => {
      const raw = decodeURIComponent(ctx.params.slug ?? '');
      return {
        pathname: `/api/v1/render/articles/${encodeURIComponent(raw)}`,
        search: `?origin=${encodeURIComponent(origin)}`,
      };
    },
    () => serviceUnavailable('The content service is unavailable. Please try again shortly.'),
  )(context);
