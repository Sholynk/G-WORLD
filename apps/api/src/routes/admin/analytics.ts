/**
 * Admin routes — editorial analytics and the live dashboard stream.
 *
 * `GET /admin/analytics/overview` returns every figure the dashboard renders
 * in one round trip (totals, trends, zero-filled daily series, author
 * leaderboard, top articles, category breakdown, recent activity).
 *
 * `GET /admin/analytics/stream` is a Server-Sent Events feed. Only a change
 * *signal* is pushed, never figures: the dashboard refetches the aggregates
 * when it is nudged, so a dropped reconnect or a duplicated event is harmless.
 *
 * Workers are many short-lived isolates, so the legacy in-process event bus
 * cannot work: a mutation on one isolate would never reach a stream on
 * another. Instead the stream polls one cheap aggregate signature every few
 * seconds and emits `change` when it differs. The stream also closes itself
 * after ~55s and lets the client's EventSource reconnect (`retry: 5000`),
 * which keeps long-lived connections from pinning an isolate.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as analyticsRepo from '../../db/repositories/analytics.js';
import { analyticsQuerySchema } from '@sholynk/shared';
import { parseQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { ok } from '../helpers.js';

export const adminAnalyticsRoutes = new Hono<AppEnv>();

const dbFrom = (c: AppContext) => createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

adminAnalyticsRoutes.get('/analytics/overview', requirePermission('analytics.read'), async (c) => {
  const query = parseQuery(c, analyticsQuerySchema);
  const db = dbFrom(c);
  return ok(c, await analyticsRepo.overview(db, { days: query.days }));
});

const POLL_INTERVAL_MS = 5_000;
const KEEP_ALIVE_COMMENT = ': keep-alive\n\n';
const MAX_STREAM_MS = 55_000;

adminAnalyticsRoutes.get('/analytics/stream', requirePermission('analytics.read'), (c) => {
  const db = dbFrom(c);
  const encoder = new TextEncoder();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed || cancelled) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      send('retry: 5000\n\n');
      send(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

      const started = Date.now();
      let lastSignature = '';

      const tick = async () => {
        if (cancelled || closed) return finish();
        try {
          const signature = await analyticsRepo.activitySignature(db);
          if (lastSignature === '') {
            lastSignature = signature;
          } else if (signature !== lastSignature) {
            lastSignature = signature;
            send(`event: change\ndata: ${JSON.stringify({ type: 'activity', at: new Date().toISOString() })}\n\n`);
          } else {
            send(KEEP_ALIVE_COMMENT);
          }
        } catch {
          send(KEEP_ALIVE_COMMENT);
        }
        if (cancelled || closed) return finish();
        if (Date.now() - started >= MAX_STREAM_MS) return finish();
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      };

      timer = setTimeout(tick, POLL_INTERVAL_MS);
    },
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  });

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache, no-transform');
  // Proxies that buffer would defeat the point of a stream.
  c.header('X-Accel-Buffering', 'no');
  return c.body(stream, 200);
});
