/**
 * The dev server's API proxy.
 *
 * The proxy sits between the browser and the API worker during development.
 * It used to forward the upstream `content-encoding` and `transfer-encoding`
 * headers while sending a body that `fetch` had already decoded, so every API
 * call in a real browser failed with ERR_CONTENT_DECODING_FAILED and the pages
 * showed their empty states. The happy-dom smoke tests never noticed: they
 * talk to the API directly.
 *
 * This test starts a fake upstream that answers with a gzipped body and then
 * asks the proxy for the same resource.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, get, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const UPSTREAM_PORT = 8797;
const PROXY_PORT = 8796;
const ROOT = path.resolve(process.cwd());

let upstream: Server;
let proxy: ChildProcess;
let sibling: string;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPort(port: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (response.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await wait(100);
  }
  return false;
}

beforeAll(async () => {
  sibling = mkdtempSync(path.join(ROOT, 'apps/web/public-validation-'));
  writeFileSync(path.join(sibling, 'probe.txt'), 'Not a public asset');
  // A gzip-encoded upstream, exactly like the worker answers.
  upstream = createServer((request, response) => {
    if (request.url === '/api/v1/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('event: ready\ndata: {}\n\n');
      return;
    }
    const data = request.url === '/api/v1/origin' ? { origin: request.headers.origin } : { path: request.url };
    const body = gzipSync(JSON.stringify({ success: true, data }));
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'content-length': String(body.length),
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', resolve));

  proxy = spawn(process.execPath, ['scripts/dev-server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PROXY_PORT),
      HOST: '127.0.0.1',
      API_TARGET: `http://127.0.0.1:${UPSTREAM_PORT}`,
    },
    stdio: 'ignore',
  });

  const up = await waitForPort(PROXY_PORT);
  if (!up) throw new Error('the dev server did not start');
});

afterAll(() => {
  proxy?.kill();
  upstream?.closeAllConnections();
  upstream?.close();
  if (sibling) rmSync(sibling, { recursive: true, force: true });
});

describe('the dev server proxy', () => {
  it('does not serve sibling directories sharing the public prefix', async () => {
    const response = await fetch(`http://127.0.0.1:${PROXY_PORT}/..%2f${path.basename(sibling)}/probe.txt`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Not a public asset');
  });

  it('maps same-host preview origins but preserves cross-origin rejection', async () => {
    for (const [host, origin, expected] of [
      [`127.0.0.1:${PROXY_PORT}`, `http://127.0.0.1:${PROXY_PORT}`, 'http://localhost:5173'],
      ['5173-preview.e2b.app', 'https://5173-preview.e2b.app', 'http://localhost:5173'],
      [`127.0.0.1:${PROXY_PORT}`, 'https://attacker.example', 'https://attacker.example'],
      [`127.0.0.1:${PROXY_PORT}`, 'null', 'null'],
    ]) {
      // Node fetch intentionally replaces Host; use raw HTTP to emulate the
      // preview reverse proxy forwarding its actual public Host header.
      const body = await new Promise<string>((resolve, reject) => {
        get({ hostname: '127.0.0.1', port: PROXY_PORT, path: '/api/v1/origin', headers: { host, origin } }, (response) => {
          let text = ''; response.setEncoding('utf8');
          response.on('data', (chunk) => { text += chunk; });
          response.on('end', () => resolve(text));
          response.on('error', reject);
        }).on('error', reject);
      });
      expect(JSON.parse(body).data.origin).toBe(expected);
    }
  });

  it('streams SSE without waiting for the upstream response to end', async () => {
    const response = await fetch(`http://127.0.0.1:${PROXY_PORT}/api/v1/events`, { signal: AbortSignal.timeout(2000) });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('event: ready');
    await reader.cancel();
  });

  it('delivers a gzipped upstream response as readable JSON', async () => {
    const response = await fetch(`http://127.0.0.1:${PROXY_PORT}/api/v1/departments`);

    expect(response.status).toBe(200);
    // The body must not claim to be compressed any more: `fetch` decoded it.
    expect(response.headers.get('content-encoding')).toBeNull();

    const body = await response.json();
    expect(body).toEqual({ success: true, data: { path: '/api/v1/departments' } });
  });

  it('sends a content-length that matches the body it forwards', async () => {
    const response = await fetch(`http://127.0.0.1:${PROXY_PORT}/api/v1/stats`);
    const text = await response.text();

    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(text)));
    expect(response.headers.get('transfer-encoding')).toBeNull();
  });
});
