/**
 * Admin router — everything under `/api/v1/admin`.
 *
 * The subtree gate is a *session* (requireAuth): every route here is behind
 * sign-in. The scope of each route is then enforced per endpoint with the
 * permission catalogue (packages/shared/src/roles.ts):
 *
 *   - editors  → submit/edit articles, upload media        (article.submit, media.write)
 *   - admins   → everything editorial + moderation + inbox + analytics
 *   - super    → admins' powers + account/role management
 *
 * Publishing, scheduling and deleting articles additionally require
 * `article.write`, which editors do not hold: their "Publish" is redirected
 * into the submit-for-review queue (see admin/articles.ts).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../../env.js';
import { authorBoundary } from '../../middleware/author-scope.js';
import { authorWorkspaceRoutes } from './author-workspace.js';
import { requireSensitiveOwnerConfirmation } from '../../middleware/owner-confirmation.js';
import { requireAuth } from '../../middleware/auth.js';
import { adminArticleRoutes } from './articles.js';
import { adminAuthorRoutes, adminSettingsRoutes } from './authors.js';
import { adminMediaRoutes } from './media.js';
import { adminInboxRoutes, adminModerationRoutes } from './inbox.js';
import { adminAnalyticsRoutes } from './analytics.js';
import { adminAccountRoutes } from './accounts.js';
import { adminSystemRoutes } from './system.js';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', requireAuth());
adminRoutes.use('*', authorBoundary);

adminRoutes.use('*', requireSensitiveOwnerConfirmation);

adminRoutes.route('/', adminArticleRoutes);
adminRoutes.route('/', adminAuthorRoutes);
adminRoutes.route('/', adminSettingsRoutes);
adminRoutes.route('/', adminMediaRoutes);
adminRoutes.route('/', adminModerationRoutes);
adminRoutes.route('/', adminInboxRoutes);
adminRoutes.route('/', adminAnalyticsRoutes);
adminRoutes.route('/', adminSystemRoutes);

adminRoutes.route('/', adminAccountRoutes);

adminRoutes.route('/', authorWorkspaceRoutes);
