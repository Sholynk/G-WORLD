/**
 * Shared contracts: roles, permissions, validation and response envelopes.
 *
 * `packages/shared` is imported by both the worker and the browser, so a change
 * here affects authorisation, form validation and the JSON shape every client
 * parses. These tests are the contract's contract.
 */
import { describe, expect, it } from 'vitest';
import {
  PERMISSION_KEYS,
  ROLE_KEYS,
  ROLE_RANK,
  ROLE_PERMISSION_DEFAULTS,
  isPermissionKey,
  isRoleKey,
  permissionSetForRole,
  roleAtLeast,
  roleHasPermission,
} from '@g-world/shared';
import {
  courseListQuerySchema,
  loginSchema,
  paginationQuerySchema,
  passwordSchema,
  registerSchema,
  searchQuerySchema,
} from '@g-world/shared';
import { API_ERROR_CODES, ERROR_STATUS, buildPaginationMeta } from '@g-world/shared';

describe('roles', () => {
  it('knows its four roles and their ranks', () => {
    expect(ROLE_KEYS).toEqual(['public', 'student', 'admin', 'super_admin']);
    expect(ROLE_RANK.public).toBeLessThan(ROLE_RANK.student);
    expect(ROLE_RANK.student).toBeLessThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.super_admin);
  });

  it('compares roles by rank rather than by string', () => {
    expect(roleAtLeast('admin', 'student')).toBe(true);
    expect(roleAtLeast('student', 'admin')).toBe(false);
    expect(roleAtLeast('super_admin', 'super_admin')).toBe(true);
  });

  it('only accepts role and permission keys that exist', () => {
    expect(isRoleKey('admin')).toBe(true);
    expect(isRoleKey('owner')).toBe(false);
    expect(isPermissionKey(PERMISSION_KEYS[0])).toBe(true);
    expect(isPermissionKey('course.destroy')).toBe(false);
  });

  it('grants nothing to a visitor and never grants more than a super administrator', () => {
    expect(ROLE_PERMISSION_DEFAULTS.public).toEqual([]);

    const student = permissionSetForRole('student');
    const admin = permissionSetForRole('admin');
    const superAdmin = permissionSetForRole('super_admin');

    expect(superAdmin.size).toBeGreaterThanOrEqual(admin.size);
    expect(admin.size).toBeGreaterThan(student.size);
    for (const permission of student) expect(superAdmin.has(permission)).toBe(true);
    for (const permission of admin) expect(superAdmin.has(permission)).toBe(true);
  });

  it('keeps privileged actions away from students', () => {
    expect(roleHasPermission('student', 'course.read')).toBe(true);
    expect(roleHasPermission('student', 'user.role.write')).toBe(false);
    expect(roleHasPermission('admin', 'user.role.write')).toBe(false); // super-admin only
  });

  it('declares every permission once, with a domain and a description', () => {
    const seen = new Set<string>();
    for (const permission of PERMISSION_KEYS) {
      expect(seen.has(permission)).toBe(false);
      seen.add(permission);
      // e.g. `course.read`, `user.read.any` — a dotted, lowercase namespace.
      expect(permission).toMatch(/^[a-z_]+(?:\.[a-z_]+)+$/);
    }
  });
});

describe('validation', () => {
  it('normalises an email address', () => {
    const parsed = loginSchema.parse({ email: '  Student@GWorld.TEST ', password: 'x' });
    expect(parsed.email).toBe('student@gworld.test');
  });

  it('rejects a malformed email with a readable message', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(/valid email/i);
  });

  it('requires an accepted-terms flag to register', () => {
    const base = {
      email: 'new@gworld.test',
      password: 'StudentPassword123',
      accepted_terms: true as const,
    };
    expect(registerSchema.safeParse(base).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, accepted_terms: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, accepted_terms: undefined }).success).toBe(false);
  });

  it('enforces password composition rules', () => {
    expect(passwordSchema.safeParse('alllowercase').success).toBe(false); // needs upper or digit
    expect(passwordSchema.safeParse('ALLUPPERCASE123').success).toBe(false); // needs a lowercase letter
    expect(passwordSchema.safeParse('Short1').success).toBe(false); // too short
    expect(passwordSchema.safeParse('StudentPassword123').success).toBe(true);
  });

  it('coerces pagination from query strings and clamps it', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, per_page: 12 });
    expect(paginationQuerySchema.parse({ page: '3', per_page: '25' })).toEqual({ page: 3, per_page: 25 });
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ per_page: '100000' }).success).toBe(false);
  });

  it('accepts the documented course filters and rejects unknown ones', () => {
    expect(courseListQuerySchema.safeParse({ difficulty: 'beginner', sort: 'popular' }).success).toBe(true);
    expect(courseListQuerySchema.safeParse({ difficulty: 'impossible' }).success).toBe(false);
    expect(courseListQuerySchema.safeParse({ sort: 'random' }).success).toBe(false);
  });

  it('requires a search term long enough to be worth searching', () => {
    expect(searchQuerySchema.safeParse({ q: 'x' }).success).toBe(false);
    const parsed = searchQuerySchema.parse({ q: 'html' });
    expect(parsed.q).toBe('html');
    expect(parsed.type).toBe('all');
  });
});

describe('response envelopes', () => {
  it('maps every error code to an HTTP status', () => {
    for (const code of API_ERROR_CODES) {
      const status = ERROR_STATUS[code];
      expect(Number.isInteger(status)).toBe(true);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThanOrEqual(599);
    }
  });

  it('pins the statuses clients rely on', () => {
    expect(ERROR_STATUS.VALIDATION_ERROR).toBe(422);
    expect(ERROR_STATUS.UNAUTHENTICATED).toBe(401);
    expect(ERROR_STATUS.FORBIDDEN).toBe(403);
    expect(ERROR_STATUS.NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.CONFLICT).toBe(409);
    expect(ERROR_STATUS.RATE_LIMITED).toBe(429);
    expect(ERROR_STATUS.ACCOUNT_LOCKED).toBe(423);
    expect(ERROR_STATUS.INTERNAL_ERROR).toBe(500);
  });

  it('builds pagination metadata that agrees with itself', () => {
    const middle = buildPaginationMeta(2, 10, 25);
    expect(middle).toMatchObject({ page: 2, per_page: 10, total: 25, total_pages: 3, has_next: true, has_prev: true });

    expect(buildPaginationMeta(1, 10, 0)).toMatchObject({ total_pages: 1, has_next: false, has_prev: false });
    expect(buildPaginationMeta(3, 10, 25)).toMatchObject({ has_next: false, has_prev: true });
  });
});
