/**
 * Assessment router — quizzes and assignments for signed-in learners.
 * Every route requires authentication; the individual handlers additionally check
 * enrollment in the relevant course.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../../env.js';
import { quizRoutes } from './quizzes.js';
import { assignmentRoutes } from './assignments.js';

export const assessmentRoutes = new Hono<AppEnv>();

assessmentRoutes.route('/', quizRoutes);
assessmentRoutes.route('/', assignmentRoutes);
