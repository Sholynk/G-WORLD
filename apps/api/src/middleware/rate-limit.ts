/**
 * Middleware — rate limiting.
 *
 * Two dimensions are limited for sensitive endpoints:
 *   - per client IP (`login:ip:<hash>`), which stops one host spraying attempts
 *   - per account (`login:acct:<userId>`) where the identifier is known, which
 *     stops a distributed attack on a single account
 *
 * The limiter is a D1 fixed window (db/repositories/rateLimit.ts). When the limit
 * is exceeded the middleware sets `Retry-After` and throws a `RATE_LIMITED`
 * error, which the error handler renders as a 429 in the standard envelope.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.js';
import { createDb } from '../db/client.js';
import { RATE_LIMIT_RULES, consume, type RateLimitRule } from '../db/repositories/rateLimit.js';
import { rateLimited } from '../lib/errors.js';

export function rateLimit(ruleName: keyof typeof RATE_LIMIT_RULES | string, scope = 'ip'): MiddlewareHandler<AppEnv> {
  const rule: RateLimitRule = RATE_LIMIT_RULES[ruleName] ?? {
    scope: String(ruleName),
    limit: 60,
    windowSeconds: 300,
  };

  return async (c, next) => {
    const db = createDb(c.env.DB, undefined);
    const identity = scope === 'account' ? (c.get('auth')?.userId ?? c.get('clientIpHash')) : c.get('clientIpHash');
    const key = `${rule.scope}:${scope}:${identity}`;

    // Development may multiply the allowance (never divide it); production is
    // pinned to the documented value by getConfig().
    const multiplier = c.get('config').rateLimitMultiplier;
    const effective: RateLimitRule =
      multiplier > 1 ? { ...rule, limit: rule.limit * multiplier } : rule;

    const state = await consume(db, key, effective);
    c.header('X-RateLimit-Limit', String(effective.limit));
    c.header('X-RateLimit-Remaining', String(state.remaining));

    if (!state.allowed) {
      c.header('Retry-After', String(state.retryAfterSeconds));
      c.get('logger')?.warn('rate limit exceeded', { scope: rule.scope, key_scope: scope, count: state.count });
      throw rateLimited(state.retryAfterSeconds);
    }

    await next();
  };
}

/**
 * Account-scoped limiter used after the email has been resolved (sign-in,
 * password reset). It keys on the normalised email so an attacker cannot avoid
 * the limit by rotating IP addresses.
 */
export function rateLimitForEmail(
  ruleName: keyof typeof RATE_LIMIT_RULES | string,
  emailSelector: (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => string,
): MiddlewareHandler<AppEnv> {
  const rule: RateLimitRule = RATE_LIMIT_RULES[ruleName] ?? {
    scope: String(ruleName),
    limit: 10,
    windowSeconds: 900,
  };

  return async (c, next) => {
    const email = emailSelector(c).trim().toLowerCase();
    if (email) {
      const db = createDb(c.env.DB, undefined);
      const key = `${rule.scope}:acct:${email.slice(0, 120)}`;
      const multiplier = c.get('config').rateLimitMultiplier;
      const effective: RateLimitRule = multiplier > 1 ? { ...rule, limit: rule.limit * multiplier } : rule;
      const state = await consume(db, key, effective);
      if (!state.allowed) {
        c.header('Retry-After', String(state.retryAfterSeconds));
        c.get('logger')?.warn('account rate limit exceeded', { scope: rule.scope });
        throw rateLimited(state.retryAfterSeconds);
      }
    }
    await next();
  };
}
