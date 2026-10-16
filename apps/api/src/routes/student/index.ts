/**
 * Student router — everything a signed-in learner can do with their own data.
 *
 * Mounted at `/api/v1`. Each sub-router applies its own guards (`requireAuth`,
 * `requireVerified`), so a newly added endpoint cannot be accidentally public.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../../env.js';
import { studentEnrollmentRoutes } from './enrollments.js';
import { studentLearningRoutes } from './learning.js';
import { studentProfileRoutes } from './profile.js';

export const studentRoutes = new Hono<AppEnv>();

studentRoutes.route('/', studentEnrollmentRoutes);
studentRoutes.route('/', studentLearningRoutes);
studentRoutes.route('/', studentProfileRoutes);
