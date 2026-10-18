/**
 * Public router — everything a signed-out reader (or the edge renderer) needs.
 *
 * Mounted flat under `/api/v1` so the ported frontend keeps the legacy path
 * shape (`/articles`, `/settings`, `/articles/:slug/reactions`, …). Editorial
 * mutations live under `/api/v1/admin` (see routes/admin/index.ts).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../../env.js';
import { publicContentRoutes } from './content.js';
import { publicEngagementRoutes } from './engagement.js';
import { publicUploadsRoutes } from './uploads.js';
import { publicSeoRoutes } from './seo.js';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.route('/', publicContentRoutes);
publicRoutes.route('/', publicEngagementRoutes);
publicRoutes.route('/', publicSeoRoutes);
publicRoutes.route('/uploads', publicUploadsRoutes);
