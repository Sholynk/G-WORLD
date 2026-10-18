/**
 * API v1 router.
 *
 * Mount order matters:
 *   1. `/api/v1` health + public routes — no session needed
 *   2. `/api/v1/auth` — the account lifecycle (each route guards itself)
 *   3. `/api/v1/admin` — session-gated subtree, permission-checked per route
 *
 * Anything not matched falls through to the JSON 404 handler registered in
 * app.ts, so the API never returns an HTML error page.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { healthRoutes } from './health.js';
import { authRoutes } from './auth.js';
import { publicRoutes } from './public/index.js';
import { adminRoutes } from './admin/index.js';

export const apiRoutes = new Hono<AppEnv>();

apiRoutes.route('/', healthRoutes);
apiRoutes.route('/auth', authRoutes);
apiRoutes.route('/', publicRoutes);
apiRoutes.route('/admin', adminRoutes);
