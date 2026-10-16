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
  /** Absolute origin of the API worker, e.g. https://g-world-api.example.workers.dev */
  API_ORIGIN?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
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
  if (!origin && !env.API) {
    return Response.json(
      {
        success: false,
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          message:
            'The frontend is not connected to an API. Set API_ORIGIN in apps/web/wrangler.toml or bind the API worker as `API`.',
        },
      },
      { status: 502 },
    );
  }

  const target = origin
    ? new URL(`${origin}${incoming.pathname}${incoming.search}`)
    : new URL(`https://api.internal${incoming.pathname}${incoming.search}`);

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

  const upstream = env.API ? await env.API.fetch(new Request(target, init)) : await fetch(target, init);
  if (!env.API && !upstream.ok && upstream.status >= 500 && !upstream.headers.get('content-type')?.includes('json')) {
    return Response.json(
      {
        success: false,
        error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'The API is not reachable from this deployment.' },
      },
      { status: 502 },
    );
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
