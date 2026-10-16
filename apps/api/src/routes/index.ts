/**
 * API v1 router.
 *
 * Mount order matters:
 *   1. `/api/v1` public routes — no session needed
 *   2. `/api/v1` authenticated routes — auth/student/assessment (each route guards
 *      itself, so a mistake here cannot expose data without a guard)
 *   3. `/api/v1/admin` — gated by role for the entire subtree
 *
 * Anything not matched falls through to the JSON 404 handler registered in
 * app.ts, so the API never returns an HTML error page.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { healthRoutes } from './health.js';
import { authRoutes } from './auth.js';
import { publicRoutes } from './public/index.js';
import { studentRoutes } from './student/index.js';
import { assessmentRoutes } from './assessments/index.js';
import { adminRoutes } from './admin/index.js';

export const apiRoutes = new Hono<AppEnv>();

apiRoutes.route('/', healthRoutes);
apiRoutes.route('/auth', authRoutes);
apiRoutes.route('/', publicRoutes);
apiRoutes.route('/', studentRoutes);
apiRoutes.route('/', assessmentRoutes);
apiRoutes.route('/admin', adminRoutes);
