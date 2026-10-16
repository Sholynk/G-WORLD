/**
 * Public router — mounted at `/api/v1` and reachable without a session.
 *
 * Everything here is read-only and serves published content plus the public
 * verification endpoints. Because the routes are listed explicitly, adding a new
 * public endpoint is a deliberate act rather than a side effect of mounting a
 * feature router.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../../env.js';
import { catalogRoutes } from './catalog.js';
import { discoveryRoutes } from './discovery.js';
import { lessonViewRoutes } from './lessons.js';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.route('/', catalogRoutes);
publicRoutes.route('/', discoveryRoutes);
publicRoutes.route('/', lessonViewRoutes);
