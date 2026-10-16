/**
 * Service — certificate issuance.
 *
 * Called from exactly two places: the lesson-completion flow (when a course
 * becomes complete) and an explicit administrator action. Both go through the
 * same eligibility check, so there is no back door that issues a certificate for
 * an unfinished course.
 *
 * Concurrency: the UNIQUE (user_id, course_id) constraint is the real guarantee.
 * If two requests race (double-click on "complete lesson"), the second insert
 * fails and the service returns the existing certificate instead of erroring.
 */
import type { Db } from '../db/client.js';
import type { AppConfig } from '../env.js';
import type { Logger } from '../lib/logger.js';
import * as certificateRepo from '../db/repositories/certificates.js';
import * as enrollmentRepo from '../db/repositories/enrollments.js';
import * as notificationsRepo from '../db/repositories/notifications.js';
import * as curriculumRepo from '../db/repositories/curriculum.js';
import * as catalogRepo from '../db/repositories/catalog.js';
import * as rolesRepo from '../db/repositories/roles.js';
import { certificateNumber as generateCertificateNumber, verificationCode as generateVerificationCode } from '../lib/ids.js';
import {
  certificateTitle,
  evaluateCertificateEligibility,
  gradeFromScore,
  type CertificateGrade,
} from '../lib/certificates.js';
import { sendEmail, TEMPLATES } from '../lib/mailer/index.js';
import { ensureCertificateQr } from './qr.js';
import { classifySqliteError } from '../db/client.js';

export interface IssueCertificateInput {
  userId: string;
  courseId: string;
  enrollmentId: string;
  /** Explicit grade, or derived from quiz performance when omitted. */
  grade?: CertificateGrade | null;
  finalScorePercent?: number | null;
  issuedBy?: string | null;
  /** Super administrators may issue without completion (documented, audited). */
  manualOverride?: boolean;
}

export interface IssueCertificateResult {
  issued: boolean;
  certificateId: string | null;
  certificateNumber: string | null;
  verificationCode: string | null;
  alreadyExisted: boolean;
  reasons: string[];
}

export async function issueCertificate(
  db: Db,
  config: AppConfig,
  logger: Logger,
  input: IssueCertificateInput,
): Promise<IssueCertificateResult> {
  const enrollment = await enrollmentRepo.findEnrollmentById(db, input.enrollmentId);
  if (!enrollment) {
    return {
      issued: false,
      certificateId: null,
      certificateNumber: null,
      verificationCode: null,
      alreadyExisted: false,
      reasons: ['Enrollment not found.'],
    };
  }

  const existing = await certificateRepo.findCertificateForUser(
    db,
    enrollment.user_id,
    enrollment.course_id,
  );
  if (existing) {
    return {
      issued: true,
      certificateId: existing.id,
      certificateNumber: existing.certificate_number,
      verificationCode: existing.verification_code,
      alreadyExisted: true,
      reasons: [],
    };
  }

  const course = await catalogRepo.findCourseById(db, enrollment.course_id);
  if (!course) {
    return {
      issued: false,
      certificateId: null,
      certificateNumber: null,
      verificationCode: null,
      alreadyExisted: false,
      reasons: ['Course not found.'],
    };
  }

  const publishedLessons = await curriculumRepo.countPublishedLessons(db, enrollment.course_id);

  const eligibility = evaluateCertificateEligibility({
    enrollmentStatus: enrollment.status,
    progressPercent: Number(enrollment.progress_percent ?? 0),
    publishedLessonCount: publishedLessons,
    certificateEnabled: Boolean(course.certificate_enabled),
    manualOverride: input.manualOverride,
  });

  if (!eligibility.eligible) {
    return {
      issued: false,
      certificateId: null,
      certificateNumber: null,
      verificationCode: null,
      alreadyExisted: false,
      reasons: eligibility.reasons,
    };
  }

  const finalScore =
    input.finalScorePercent ??
    (enrollment.average_quiz_score === null ? null : Number(enrollment.average_quiz_score));
  const number = generateCertificateNumber();
  const verification = generateVerificationCode();
  const grade = input.grade ?? gradeFromScore(finalScore);

  let certificateId: string;
  try {
    certificateId = await certificateRepo.createCertificate(db, {
      userId: enrollment.user_id,
      courseId: enrollment.course_id,
      enrollmentId: enrollment.id,
      certificateNumber: number,
      verificationCode: verification,
      title: certificateTitle(enrollment.course_title),
      grade,
      finalScorePercent: finalScore,
      issuedBy: input.issuedBy ?? null,
    });
  } catch (error) {
    // A concurrent request won the race: return that certificate.
    const info = classifySqliteError(error);
    if (info.kind === 'unique') {
      const raced = await certificateRepo.findCertificateForUser(db, enrollment.user_id, enrollment.course_id);
      if (raced) {
        return {
          issued: true,
          certificateId: raced.id,
          certificateNumber: raced.certificate_number,
          verificationCode: raced.verification_code,
          alreadyExisted: true,
          reasons: [],
        };
      }
    }
    logger.error('certificate issuance failed', {
      user_id: enrollment.user_id,
      course_id: enrollment.course_id,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return {
      issued: false,
      certificateId: null,
      certificateNumber: null,
      verificationCode: null,
      alreadyExisted: false,
      reasons: ['Certificate could not be issued.'],
    };
  }

  await enrollmentRepo.markCertificateIssued(db, enrollment.id);
  await ensureCertificateQr(db, config, {
    userId: enrollment.user_id,
    certificateId,
    verificationCode: verification,
  });

  await notificationsRepo.createNotification(db, {
    userId: enrollment.user_id,
    type: 'certificate',
    title: 'Certificate issued',
    body: `Your certificate for “${enrollment.course_title}” is ready (${number}).`,
    linkUrl: `/certificate.html?id=${encodeURIComponent(certificateId)}`,
  });

  const userEmail = enrollment.user_email;
  if (userEmail) {
    await sendEmail(db, config, logger, userEmail, {
      userId: enrollment.user_id,
      content: TEMPLATES.certificateIssuedEmail({
        toEmail: userEmail,
        displayName: enrollment.student_name,
        courseTitle: enrollment.course_title,
        certificateNumber: number,
        verificationCode: verification,
        branding: { siteName: 'G WORLD', appBaseUrl: config.appBaseUrl },
      }),
    });
  }

  logger.info('certificate issued', {
    certificate_id: certificateId,
    user_id: enrollment.user_id,
    course_id: enrollment.course_id,
    grade,
  });

  return {
    issued: true,
    certificateId,
    certificateNumber: number,
    verificationCode: verification,
    alreadyExisted: false,
    reasons: [],
  };
}

/** Revocation keeps the row (history) and flips the validity flag. */
export async function revokeCertificate(
  db: Db,
  certificateId: string,
  reason: string,
): Promise<boolean> {
  const changed = await certificateRepo.revokeCertificate(db, certificateId, reason);
  return changed > 0;
}

/** Whether the acting role may issue certificates without completion. */
export async function canOverrideEligibility(db: Db, roleKey: string): Promise<boolean> {
  if (roleKey !== 'super_admin') return false;
  const permissions = await rolesRepo.listPermissionKeysForRoleKey(db, 'super_admin');
  return permissions.includes('certificate.write');
}
