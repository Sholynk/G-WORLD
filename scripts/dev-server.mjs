#!/usr/bin/env node
/**
 * G WORLD — local development server for the static frontend.
 *
 * Serves `apps/web/public` and proxies `/api/*` to the API worker, so the
 * browser talks to **one origin** in development exactly as it does in
 * production (where Cloudflare Pages proxies `/api/*` to the Worker through a
 * service binding). That single-origin design is what makes the session cookie
 * `SameSite=Lax` and the CSRF double-submit work without CORS.
 *
 *   npm run dev:web                 # http://localhost:5173
 *   PORT=32951 npm run dev:web      # any port (the preview sandbox uses this)
 *   API_TARGET=http://127.0.0.1:9000 npm run dev:web
 *
 * Design notes
 *   - Binds 0.0.0.0 so a container/preview proxy can reach it; no host allow-list
 *     is enforced, because the dev sandbox is addressed by several hostnames.
 *   - Deliberately sends **no** `X-Frame-Options`/`frame-ancestors` header: the
 *     preview UI embeds the app in an iframe, and the production policy for the
 *     Pages site is set in `apps/web/public/_headers` instead.
 *   - Zero dependencies: `node:http` + `node:fs` only.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'apps', 'web', 'public');
const PORT = Number.parseInt(process.env.PORT ?? '5173', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const API_TARGET = (process.env.API_TARGET ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

/** Friendly URL → file, mirroring the `_redirects` file used by Pages. */
const PRETTY_ROUTES = {
  '/': 'index.html',
  '/departments': 'departments.html',
  '/subjects': 'subjects.html',
  '/subject': 'subject.html',
  '/courses': 'courses.html',
  '/search': 'search.html',
  '/login': 'login.html',
  '/register': 'register.html',
  '/reset': 'reset.html',
  '/dashboard': 'dashboard.html',
  '/my-courses': 'my-courses.html',
  '/progress': 'progress.html',
  '/certificates': 'certificates.html',
  '/profile': 'profile.html',
  '/settings': 'settings.html',
  '/verify': 'verify.html',
  '/admin': 'admin/index.html',
};

/**
 * Parses `_redirects` (Netlify/Pages syntax) into rules.
 *
 * `:name` placeholders become capture groups, so `/verify/:code` works the same
 * way it does on Pages. A `200` rule is a *rewrite*: the visitor keeps the
 * address they typed and we serve the target document from disk (issuing a
 * `Location` header with a 200 would leave the browser showing an empty page).
 */
async function loadRedirects() {
  const file = path.join(PUBLIC_DIR, '_redirects');
  if (!existsSync(file)) return [];
  const text = await readFile(file, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map(([from, to, status]) => {
      const names = [];
      // `*` is a splat that may span slashes and `:name` is a single path
      // segment — the Netlify/Pages syntax. Both become capture groups, in the
      // order they appear in the rule, and are substituted back into the target.
      const source = from
        .split(/(\*|:[A-Za-z0-9_]+)/)
        .map((part) => {
          if (part === '*') {
            names.push('splat');
            return '(.*)';
          }
          const placeholder = /^:([A-Za-z0-9_]+)$/.exec(part);
          if (placeholder) {
            names.push(placeholder[1]);
            return '([^/]+)';
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      return {
        from,
        to,
        status: status ? Number(status) : 200,
        regex: new RegExp(`^${source}/?$`),
        names,
      };
    });
}

const redirects = await loadRedirects();

/** Matches a path against one rule and returns the substituted target, or null. */
function applyRule(rule, pathname) {
  const match = rule.regex.exec(pathname);
  if (!match) return null;
  let target = rule.to;
  rule.names.forEach((name, index) => {
    target = target.replace(`:${name}`, encodeURIComponent(match[index + 1]));
  });
  return target;
}

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const relative = clean.replace(/^\/+/, '');

  // Path traversal guard: the resolved path must stay inside PUBLIC_DIR.
  const candidate = path.resolve(PUBLIC_DIR, relative);
  if (!candidate.startsWith(PUBLIC_DIR)) return null;

  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;

  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    const index = path.join(candidate, 'index.html');
    if (existsSync(index)) return index;
  }

  if (!path.extname(relative)) {
    const html = path.join(PUBLIC_DIR, `${relative}.html`);
    if (existsSync(html)) return html;
    const mapped = PRETTY_ROUTES[clean.replace(/\/$/, '') || '/'];
    if (mapped) {
      const target = path.join(PUBLIC_DIR, mapped);
      if (existsSync(target)) return target;
    }
  }

  return null;
}

/**
 * Streams a file from `public/` with the headers the deployed site would send.
 *
 * No `X-Frame-Options` or `frame-ancestors` header is set: the preview runs
 * inside an iframe, and the static host's own header file (`public/_headers`)
 * is the single place that decides framing for production.
 */
async function sendFile(file, request, response) {
  const extension = path.extname(file).toLowerCase();
  const headers = {
    'Content-Type': MIME[extension] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
    // HTML is never cached in dev: a refresh must show the current file.
    'Cache-Control': extension === '.html' ? 'no-store' : 'no-cache',
    'X-Request-Id': `dev_${Date.now().toString(36)}`,
  };

  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

async function proxy(request, response) {
  const target = `${API_TARGET}${request.url}`;
  const headers = { ...request.headers, host: new URL(API_TARGET).host };

  const hasBody = !['GET', 'HEAD'].includes(request.method ?? 'GET');
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request : undefined,
    duplex: hasBody ? 'half' : undefined,
    redirect: 'manual',
  });

  const outgoing = {};
  for (const [key, value] of upstream.headers.entries()) {
    // `set-cookie` must be forwarded one value per header line.
    if (key.toLowerCase() === 'set-cookie') continue;
    outgoing[key] = value;
  }
  const cookies = upstream.headers.getSetCookie?.() ?? [];

  response.writeHead(upstream.status, { ...outgoing, ...(cookies.length ? { 'set-cookie': cookies } : {}) });
  const buffer = Buffer.from(await upstream.arrayBuffer());
  response.end(buffer);
}

const server = http.createServer(async (request, response) => {
  const url = request.url ?? '/';

  try {
    if (url.startsWith('/api/') || url === '/api') {
      await proxy(request, response);
      return;
    }

    const pathname = url.split('?')[0];

    // `_redirects` first, exactly as the host would evaluate it.
    for (const rule of redirects) {
      const target = applyRule(rule, pathname);
      if (!target) continue;

      if (rule.status === 200) {
        const rewritten = resolveFile(target);
        if (rewritten) {
          await sendFile(rewritten, request, response);
          return;
        }
        continue; // a rewrite with no target on disk falls through to 404
      }

      response.writeHead(rule.status, {
        Location: target,
        'Cache-Control': 'no-store',
      });
      response.end();
      return;
    }

    const file = resolveFile(url);
    if (!file) {
      const notFound = path.join(PUBLIC_DIR, '404.html');
      const body = existsSync(notFound) ? await readFile(notFound) : 'Not found';
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(body);
      return;
    }

    await sendFile(file, request, response);
  } catch (error) {
    const isProxyError = url.startsWith('/api/');
    response.writeHead(isProxyError ? 502 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(
      JSON.stringify({
        success: false,
        error: {
          code: isProxyError ? 'DEPENDENCY_UNAVAILABLE' : 'INTERNAL_ERROR',
          message: isProxyError
            ? `Cannot reach the API at ${API_TARGET}. Start it with: npm run dev:api`
            : 'The dev server hit an unexpected error.',
          detail: String(error?.message ?? error),
        },
      }),
    );
  }
});

server.listen(PORT, HOST, () => {
  console.log('G WORLD web — static frontend + /api proxy');
  console.log(`  local:    http://localhost:${PORT}`);
  console.log(`  network:  http://${HOST}:${PORT}`);
  console.log(`  proxying  /api/* → ${API_TARGET}`);
  console.log(`  serving   ${path.relative(ROOT, PUBLIC_DIR)}`);
});
