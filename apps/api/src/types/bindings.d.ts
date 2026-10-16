/**
 * Cloudflare runtime types for the G WORLD Worker.
 *
 * `@cloudflare/workers-types` provides D1Database, R2Bucket, ScheduledController,
 * ExecutionContext and the rest of the runtime surface. It is referenced here
 * rather than in tsconfig `types` so that `packages/shared` (which must stay
 * runtime-agnostic) does not pick it up.
 */
/// <reference types="@cloudflare/workers-types" />

import type { AppEnv } from '../env.js';

declare module 'hono' {
  interface ContextVariableMap {
    requestId: AppEnv['Variables']['requestId'];
    logger: AppEnv['Variables']['logger'];
    clientIpHash: AppEnv['Variables']['clientIpHash'];
    auth: AppEnv['Variables']['auth'];
    config: AppEnv['Variables']['config'];
  }
}

/** Values Cloudflare injects into every request. */
export interface CloudflareRequestProperties {
  cf?: {
    country?: string;
    city?: string;
    timezone?: string;
    colo?: string;
    asn?: number;
  };
  ray?: string;
}
