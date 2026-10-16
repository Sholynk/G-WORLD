/**
 * Admin router — mounted at `/api/v1/admin`.
 *
 * The gate is applied once, here: **every** request under this prefix requires a
 * signed-in user whose role is at least `admin`. Individual handlers then require
 * the precise permission they need, so:
 *
 *   role check (this file)  →  "is this person staff at all?"
 *   permission check (route) → "may this staff member touch this resource?"
 *
 * Both checks run on the server against the database-backed role and permission
 * set. The frontend hides admin navigation for learners, but that is cosmetic —
 * an unauthenticated or student request to any of these paths returns 401/403
 * before a handler body executes.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../../env.js';
import { requireRole } from '../../middleware/auth.js';
import { adminCatalogRoutes } from './catalog.js';
import { adminCurriculumRoutes } from './curriculum.js';
import { adminStudentRoutes } from './students.js';
import { adminLearningRoutes } from './learning.js';
import { adminSystemRoutes } from './system.js';

export const adminRoutes = new Hono<AppEnv>();

// Gate the whole subtree. `requireRole('admin')` compares role ranks from the
// database, so it also admits `super_admin` and would reject a `student` even if
// they somehow held a content permission.
adminRoutes.use('*', requireRole('admin'));

adminRoutes.route('/', adminCatalogRoutes);
adminRoutes.route('/', adminCurriculumRoutes);
adminRoutes.route('/', adminStudentRoutes);
adminRoutes.route('/', adminLearningRoutes);
adminRoutes.route('/', adminSystemRoutes);
