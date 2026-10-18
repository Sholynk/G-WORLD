/**
 * Pages Function — the legacy `/article?slug=…` (and `/article.html?slug=…`,
 * which Pages redirects here). Old shared links keep working: the API answers
 * with a 301 to the clean URL, a 302 to an external destination, or a 404.
 */
import { proxiedDocument, serviceUnavailable } from './_lib/presentation';

export const onRequest = proxiedDocument(
  (context, origin) => {
    const slug = new URL(context.request.url).searchParams.get('slug') ?? '';
    return {
      pathname: '/api/v1/render/legacy-article',
      search: `?slug=${encodeURIComponent(slug)}&origin=${encodeURIComponent(origin)}`,
    };
  },
  () => serviceUnavailable('The content service is unavailable. Please try again shortly.'),
);
