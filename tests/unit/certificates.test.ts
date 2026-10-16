/**
 * Certificate eligibility and grading.
 *
 * A certificate is a public claim about a person, so the rules that decide one
 * gets issued are pinned down here: completed enrolment, full progress, at least
 * one published lesson, overridable only by a super administrator.
 */
import { describe, expect, it } from 'vitest';
import {
  GRADE_LABELS,
  certificateTitle,
  evaluateCertificateEligibility,
  gradeFromScore,
} from '../../apps/api/src/lib/certificates.js';

const base = {
  enrollmentStatus: 'completed' as const,
  progressPercent: 100,
  publishedLessonCount: 5,
  certificateEnabled: true,
};

describe('eligibility', () => {
  it('issues for a completed course with full progress', () => {
    const result = evaluateCertificateEligibility(base);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('collects every reason a learner is not eligible, not just the first', () => {
    const result = evaluateCertificateEligibility({
      ...base,
      enrollmentStatus: 'active',
      progressPercent: 60,
      publishedLessonCount: 0,
      certificateEnabled: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
    expect(result.reasons.join(' ')).toMatch(/completed/i);
    expect(result.reasons.join(' ')).toMatch(/no published lessons|published lesson/i);
    expect(result.reasons.join(' ')).toMatch(/disabled/i);
  });

  it('lets a manual override bypass completion but not an empty course', () => {
    const overridden = evaluateCertificateEligibility({
      ...base,
      enrollmentStatus: 'active',
      progressPercent: 40,
      certificateEnabled: false,
      manualOverride: true,
    });
    expect(overridden.eligible).toBe(true);

    const emptyCourse = evaluateCertificateEligibility({
      ...base,
      publishedLessonCount: 0,
      manualOverride: true,
    });
    expect(emptyCourse.eligible).toBe(false);
  });
});

describe('grade bands', () => {
  it('maps a score to distinction / merit / pass at the documented thresholds', () => {
    expect(gradeFromScore(100)).toBe('distinction');
    expect(gradeFromScore(90)).toBe('distinction');
    expect(gradeFromScore(89.9)).toBe('merit');
    expect(gradeFromScore(75)).toBe('merit');
    expect(gradeFromScore(74.9)).toBe('pass');
    expect(gradeFromScore(0)).toBe('pass');
  });

  it('falls back to pass when no score exists', () => {
    expect(gradeFromScore(null)).toBe('pass');
    expect(gradeFromScore(undefined)).toBe('pass');
    expect(gradeFromScore(Number.NaN)).toBe('pass');
  });

  it('has a label for every band', () => {
    for (const band of ['pass', 'merit', 'distinction'] as const) {
      expect(GRADE_LABELS[band]).toBeTruthy();
    }
    expect(Object.keys(GRADE_LABELS)).toHaveLength(3);
  });
});

describe('the printed title', () => {
  it('names the course on the certificate', () => {
    expect(certificateTitle('HTML & CSS Foundations')).toBe('Certificate of Completion — HTML & CSS Foundations');
  });
});
