/**
 * Cloudflare Pages Function — `/api/*` on the frontend deployment.
 *
 * The site is static and the API is a separate Worker. Rather than putting the
 * worker's hostname into the browser, Pages forwards `/api/*` from the same
 * origin. That keeps one origin for cookies (so the session cookie is first-party
 * and `SameSite=Lax` is enough), avoids CORS entirely, and means the frontend can
 * be pointed at a staging API without touching any client code.
 *
 * Two ways to reach the API, in order of preference:
 *   1. a service binding named `API` (same-account Worker to Worker, no public
 *      hop, no TLS handshake) — configure it in wrangler.toml;
 *   2. the `API_ORIGIN` variable, used for local `wrangler pages dev` and for a
 *      staging origin that lives in a different account.
 *
 * Nothing is injected here: no tokens, no header rewriting beyond what the
 * browser sent. Authorisation stays entirely inside the API worker.
 */

interface Env {
  /** Optional service binding to the API worker (see wrangler.toml). */
  API?: { fetch: (request: Request) => Promise<Response> };
  /** Absolute origin of the API worker, e.g. https://sholynk-tech-api.<your-subdomain>.workers.dev */
  API_ORIGIN?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

/**
 * One failure shape for every "the API is not there" case, so the browser always
 * gets the same JSON envelope the API itself returns (see
 * `apps/api/src/lib/errors.ts`) instead of an HTML error page or a bare stack
 * trace. Messages are configuration reminders, never secrets.
 */
const unavailable = (message: string, status = 502): Response =>
  Response.json({ success: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message } }, { status });

/**
 * Builds the upstream URL for `API_ORIGIN`, or null when that value cannot be
 * turned into one — a leftover placeholder such as
 * `https://sholynk-tech-api.<your-subdomain>.workers.dev` is not a valid URL (angle
 * brackets are forbidden in a host), and `new URL` throws on it. That throw used
 * to surface as an opaque `500 TypeError`, which is exactly the case an
 * unconfigured deployment hits first.
 */
function upstreamUrl(origin: string, pathname: string, search: string): URL | null {
  try {
    const url = new URL(`${origin}${pathname}${search}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const { request, env } = context;
  const incoming = new URL(request.url);

  const origin = (env.API_ORIGIN ?? '').replace(/\/+$/, '');
  // A binding wins over the variable: it is same-account routing and the only
  // value that can be resolved without the public internet.
  if (!origin && !env.API) {
    return unavailable(
      'The frontend is not connected to an API. Set API_ORIGIN in apps/web/wrangler.toml or bind the API worker as `API`.',
    );
  }

  const target = origin
    ? upstreamUrl(origin, incoming.pathname, incoming.search)
    : new URL(`https://api.internal${incoming.pathname}${incoming.search}`);

  if (!target) {
    return unavailable(
      'API_ORIGIN is not a valid absolute http(s) URL. Fix it in apps/web/wrangler.toml (or configure the `API` service binding) and redeploy the frontend.',
    );
  }

  const headers = new Headers(request.headers);
  for (const header of HOP_BY_HOP) headers.delete(header);
  // Let the API decide the client address from the standard forwarding headers
  // it already trusts; nothing else is added or removed.
  headers.set('x-forwarded-host', incoming.host);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const init: RequestInit = {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
  };

  // A DNS failure, a refused connection or a binding that no longer exists
  // rejects the promise; answer with the same envelope as an unreachable-but-ok
  // upstream rather than letting the runtime produce a 500.
  let upstream: Response;
  try {
    upstream = env.API ? await env.API.fetch(new Request(target, init)) : await fetch(new Request(target, init));
  } catch {
    return unavailable('The API is not reachable from this deployment.');
  }

  if (!env.API && !upstream.ok && upstream.status >= 500 && !upstream.headers.get('content-type')?.includes('json')) {
    return unavailable('The API is not reachable from this deployment.');
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const header of HOP_BY_HOP) responseHeaders.delete(header);
  // The upstream `content-length` can disagree after decompression, so let the
  // edge recompute it.
  responseHeaders.delete('content-length');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
