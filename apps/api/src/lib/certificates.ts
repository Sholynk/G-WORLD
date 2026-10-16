/**
 * G WORLD — certificate rules.
 *
 * A certificate is a claim about a learner, so the rules that create one are
 * explicit and conservative:
 *   - the course must have certificates enabled
 *   - the enrolment must be complete (100% of published lessons)
 *   - the course must have at least one published lesson
 *   - certificates are issued once per (learner, course) pair
 * Revocation is a separate, audited operation that never deletes the record.
 */

export interface CertificateEligibilityInput {
  enrollmentStatus: 'active' | 'completed' | 'cancelled' | 'expired';
  progressPercent: number;
  publishedLessonCount: number;
  certificateEnabled: boolean;
  /** Super administrators may issue manually; everyone else needs completion. */
  manualOverride?: boolean;
}

export interface CertificateEligibility {
  eligible: boolean;
  reasons: string[];
}

export function evaluateCertificateEligibility(
  input: CertificateEligibilityInput,
): CertificateEligibility {
  const reasons: string[] = [];

  if (!input.certificateEnabled && !input.manualOverride) {
    reasons.push('Certificates are disabled for this course.');
  }
  if (input.publishedLessonCount < 1) {
    reasons.push('The course has no published lessons yet.');
  }
  if (!input.manualOverride) {
    if (input.enrollmentStatus !== 'completed') {
      reasons.push('The course is not marked as completed.');
    }
    if (input.progressPercent < 100) {
      reasons.push(`Progress is ${input.progressPercent}% (100% required).`);
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

export type CertificateGrade = 'pass' | 'merit' | 'distinction';

/**
 * Grade from the learner's final score. Thresholds are intentionally generous
 * at the bottom (any pass earns a certificate) and demanding at the top.
 */
export function gradeFromScore(scorePercent: number | null | undefined): CertificateGrade {
  if (scorePercent === null || scorePercent === undefined || Number.isNaN(scorePercent)) return 'pass';
  if (scorePercent >= 90) return 'distinction';
  if (scorePercent >= 75) return 'merit';
  return 'pass';
}

export const GRADE_LABELS: Record<CertificateGrade, string> = {
  pass: 'Pass',
  merit: 'Merit',
  distinction: 'Distinction',
};

/** Human-readable title printed on the certificate document. */
export function certificateTitle(courseTitle: string): string {
  return `Certificate of Completion — ${courseTitle}`;
}

/**
 * The verification page must answer yes/no without exposing the learner's
 * private data. This projection is exactly what the public endpoint returns.
 */
export interface PublicCertificateView {
  certificate_number: string;
  verification_code: string;
  course_title: string;
  holder_name: string;
  student_number: string | null;
  grade: CertificateGrade | null;
  issued_at: string;
  revoked: boolean;
  valid: boolean;
}

export function redactCertificateForPublic(view: {
  certificateNumber: string;
  verificationCode: string;
  courseTitle: string;
  holderName: string | null;
  studentNumber: string | null;
  grade: CertificateGrade | null;
  issuedAt: string;
  revokedAt: string | null;
}): PublicCertificateView {
  return {
    certificate_number: view.certificateNumber,
    verification_code: view.verificationCode,
    course_title: view.courseTitle,
    holder_name: view.holderName ?? 'G WORLD learner',
    student_number: view.studentNumber,
    grade: view.grade,
    issued_at: view.issuedAt,
    revoked: Boolean(view.revokedAt),
    valid: !view.revokedAt,
  };
}
