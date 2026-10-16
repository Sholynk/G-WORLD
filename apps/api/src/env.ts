/**
 * G WORLD — Worker environment: bindings, variables and configuration access.
 *
 * Everything the Worker needs comes from bindings (`DB`, `BUCKET`) or from
 * environment variables/secrets, never from hardcoded values. `getConfig()`
 * validates the shape once per request and produces a frozen config object that
 * the rest of the application reads.
 */
import type { Context } from 'hono';
import type { Logger } from './lib/logger.js';

/** Cloudflare bindings + environment variables/secrets. */
export interface Bindings {
  // --- Bindings -----------------------------------------------------------
  /** D1 database (logical name `g_world`). */
  DB: D1Database;
  /** R2 bucket for uploads. Optional: features degrade gracefully without it. */
  BUCKET?: R2Bucket;

  // --- Vars and secrets ---------------------------------------------------
  ENVIRONMENT?: string;
  /** Development-only rate-limit relaxation (see AppConfig.rateLimitMultiplier). */
  RATE_LIMIT_MULTIPLIER?: string;
  /** HMAC key for opaque tokens. Required in production. */
  SESSION_SECRET?: string;
  /** Comma-separated browser origins allowed to call the API cross-origin. */
  ALLOWED_ORIGINS?: string;
  /** `console` (default) or `resend`. */
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  EMAIL_API_BASE_URL?: string;
  APP_BASE_URL?: string;
  API_BASE_URL?: string;
  /** `true`/`false` string flags. */
  ENABLE_REGISTRATION?: string;
  ENABLE_DEV_ROUTES?: string;
  /** PBKDF2 iteration override — see docs/adr/0004. */
  PASSWORD_ITERATIONS?: string;
  /** Session lifetime in hours. */
  SESSION_TTL_HOURS?: string;
}

/** Per-request values stored on the Hono context. */
export interface Variables {
  requestId: string;
  logger: Logger;
  clientIpHash: string;
  auth: AuthContext | null;
  config: AppConfig;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
export type AppContext = Context<AppEnv>;

/** Authenticated principal resolved by the auth middleware. */
export interface AuthContext {
  userId: string;
  email: string;
  roleKey: 'public' | 'student' | 'admin' | 'super_admin';
  roleRank: number;
  permissions: string[];
  status: 'pending_verification' | 'active' | 'suspended' | 'deactivated';
  emailVerified: boolean;
  sessionId: string;
  displayName: string | null;
  studentNumber: string | null;
}

export interface EmailConfig {
  provider: 'console' | 'resend';
  from: string;
  apiKey: string | null;
  apiBaseUrl: string;
}

export interface FeatureFlags {
  registration: boolean;
  devRoutes: boolean;
  fileUploads: boolean;
}

export interface AppConfig {
  environment: string;
  isProduction: boolean;
  isDevelopment: boolean;
  sessionSecret: string;
  sessionTtlHours: number;
  allowedOrigins: string[];
  appBaseUrl: string;
  apiBaseUrl: string;
  passwordIterations: number;
  /**
   * Development-only relaxation of the fixed-window rate limits. Production is
   * always 1; in development a multiplier keeps a test run (or a flaky browser
   * session) from exhausting the sign-in limit and locking the developer out of
   * their own local database.
   */
  rateLimitMultiplier: number;
  email: EmailConfig;
  features: FeatureFlags;
}

export const PASSWORD_ITERATIONS_DEFAULT = 100_000;
export const PASSWORD_ITERATIONS_FLOOR = 10_000;

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function getConfig(env: Bindings): AppConfig {
  const environment = (env.ENVIRONMENT ?? 'development').toLowerCase();
  const isProduction = environment === 'production';
  const isDevelopment = !isProduction;

  const provider = (env.EMAIL_PROVIDER ?? 'console').toLowerCase() === 'resend' ? 'resend' : 'console';
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    environment,
    isProduction,
    isDevelopment,
    sessionSecret: env.SESSION_SECRET ?? 'insecure-development-only-secret',
    sessionTtlHours: int(env.SESSION_TTL_HOURS, 24 * 14, 1, 24 * 365),
    allowedOrigins,
    appBaseUrl: env.APP_BASE_URL ?? 'http://localhost:5173',
    apiBaseUrl: env.API_BASE_URL ?? '/api/v1',
    passwordIterations: Math.max(
      PASSWORD_ITERATIONS_FLOOR,
      int(env.PASSWORD_ITERATIONS, PASSWORD_ITERATIONS_DEFAULT, PASSWORD_ITERATIONS_FLOOR, 2_000_000),
    ),
    rateLimitMultiplier: isProduction
      ? 1
      : int(env.RATE_LIMIT_MULTIPLIER, 1, 1, 100),
    email: {
      provider,
      from: env.EMAIL_FROM ?? 'G WORLD <no-reply@gworld.example>',
      apiKey: env.RESEND_API_KEY?.trim() || null,
      apiBaseUrl: env.EMAIL_API_BASE_URL ?? 'https://api.resend.com',
    },
    features: {
      registration: bool(env.ENABLE_REGISTRATION, true),
      devRoutes: bool(env.ENABLE_DEV_ROUTES, isDevelopment),
      fileUploads: Boolean(env.BUCKET),
    },
  };
}

/**
 * Production misconfiguration is a security problem, not a warning: a known
 * default session secret would let anyone forge sessions. The health endpoint
 * surfaces these so a bad deploy is caught immediately.
 */
export function findConfigProblems(config: AppConfig, env: Bindings): string[] {
  const problems: string[] = [];
  if (config.isProduction) {
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
      problems.push('SESSION_SECRET must be set to a random value of at least 32 characters in production.');
    }
    if (env.SESSION_SECRET?.includes('dev-only') || env.SESSION_SECRET?.includes('change-me')) {
      problems.push('SESSION_SECRET still contains the development placeholder value.');
    }
    if (config.email.provider === 'resend' && !config.email.apiKey) {
      problems.push('EMAIL_PROVIDER=resend requires RESEND_API_KEY.');
    }
    if (!env.DB) {
      problems.push('D1 binding "DB" is missing.');
    }
  }
  return problems;
}

export function configFrom(c: AppContext): AppConfig {
  return c.get('config');
}
