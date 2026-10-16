/**
 * Repository — certificates.
 *
 * A certificate row is immutable except for revocation. `verification_code` is
 * the public lookup key used by the verification page and by QR scans, while
 * `certificate_number` is the printed document number; both are UNIQUE, and
 * UNIQUE (user_id, course_id) guarantees one certificate per learner per course.
 */
import type { Db } from '../client.js';
import { newId, ID_PREFIXES } from '../../lib/ids.js';
import type { CertificateGrade } from '../../lib/certificates.js';

export interface CertificateRow {
  id: string;
  user_id: string;
  course_id: string;
  enrollment_id: string;
  certificate_number: string;
  verification_code: string;
  title: string;
  grade: CertificateGrade | null;
  final_score_percent: number | null;
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CertificateDetailRow extends CertificateRow {
  course_title: string;
  course_slug: string;
  course_difficulty: string;
  subject_name: string;
  department_name: string;
  holder_email: string;
  holder_name: string | null;
  student_number: string | null;
}

const CERTIFICATE_DETAIL_SELECT = `
  SELECT cert.id, cert.user_id, cert.course_id, cert.enrollment_id, cert.certificate_number,
         cert.verification_code, cert.title, cert.grade, cert.final_score_percent, cert.issued_at,
         cert.expires_at, cert.revoked_at, cert.revoked_reason, cert.created_at, cert.updated_at,
         c.title AS course_title, c.slug AS course_slug, c.difficulty AS course_difficulty,
         s.name AS subject_name, d.name AS department_name,
         u.email AS holder_email,
         COALESCE(sp.display_name, sp.full_name) AS holder_name,
         sp.student_number AS student_number
    FROM certificates cert
    JOIN courses c ON c.id = cert.course_id
    JOIN subjects s ON s.id = c.subject_id
    JOIN departments d ON d.id = s.department_id
    JOIN users u ON u.id = cert.user_id
    LEFT JOIN student_profiles sp ON sp.user_id = cert.user_id`;

export interface CreateCertificateInput {
  userId: string;
  courseId: string;
  enrollmentId: string;
  certificateNumber: string;
  verificationCode: string;
  title: string;
  grade?: CertificateGrade | null;
  finalScorePercent?: number | null;
  issuedBy?: string | null;
}

export async function createCertificate(db: Db, input: CreateCertificateInput): Promise<string> {
  const id = newId(ID_PREFIXES.certificate);
  await db.run(
    `INSERT INTO certificates (id, user_id, course_id, enrollment_id, certificate_number,
                               verification_code, title, grade, final_score_percent, issued_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.courseId,
      input.enrollmentId,
      input.certificateNumber,
      input.verificationCode,
      input.title,
      input.grade ?? null,
      input.finalScorePercent ?? null,
      input.issuedBy ?? null,
    ],
  );
  return id;
}

export async function findCertificateById(db: Db, id: string): Promise<CertificateDetailRow | null> {
  return db.first<CertificateDetailRow>(`${CERTIFICATE_DETAIL_SELECT} WHERE cert.id = ? LIMIT 1`, [id]);
}

export async function findCertificateForUser(
  db: Db,
  userId: string,
  courseId: string,
): Promise<CertificateRow | null> {
  return db.first<CertificateRow>(
    `SELECT id, user_id, course_id, enrollment_id, certificate_number, verification_code, title, grade,
            final_score_percent, issued_at, expires_at, revoked_at, revoked_reason, created_at, updated_at
       FROM certificates WHERE user_id = ? AND course_id = ? LIMIT 1`,
    [userId, courseId],
  );
}

export async function findCertificateByEnrollment(
  db: Db,
  enrollmentId: string,
): Promise<CertificateRow | null> {
  return db.first<CertificateRow>(
    `SELECT id, user_id, course_id, enrollment_id, certificate_number, verification_code, title, grade,
            final_score_percent, issued_at, expires_at, revoked_at, revoked_reason, created_at, updated_at
       FROM certificates WHERE enrollment_id = ? LIMIT 1`,
    [enrollmentId],
  );
}

/** Public verification lookup — by short verification code or document number. */
export async function findCertificateByCode(
  db: Db,
  code: string,
): Promise<CertificateDetailRow | null> {
  return db.first<CertificateDetailRow>(
    `${CERTIFICATE_DETAIL_SELECT}
      WHERE cert.verification_code = ? COLLATE NOCASE OR cert.certificate_number = ? COLLATE NOCASE
      LIMIT 1`,
    [code, code],
  );
}

export async function listCertificatesForUser(db: Db, userId: string): Promise<CertificateDetailRow[]> {
  return db.all<CertificateDetailRow>(
    `${CERTIFICATE_DETAIL_SELECT} WHERE cert.user_id = ? ORDER BY cert.issued_at DESC`,
    [userId],
  );
}

export interface AdminCertificateFilters {
  q?: string | null;
  courseId?: string | null;
  userId?: string | null;
  revoked?: boolean | null;
  page: number;
  perPage: number;
}

export async function listCertificatesForAdmin(
  db: Db,
  filters: AdminCertificateFilters,
): Promise<{ items: CertificateDetailRow[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.courseId) {
    conditions.push(`cert.course_id = ?`);
    params.push(filters.courseId);
  }
  if (filters.userId) {
    conditions.push(`cert.user_id = ?`);
    params.push(filters.userId);
  }
  if (filters.revoked !== null && filters.revoked !== undefined) {
    conditions.push(filters.revoked ? `cert.revoked_at IS NOT NULL` : `cert.revoked_at IS NULL`);
  }
  if (filters.q) {
    conditions.push(`(cert.certificate_number LIKE ? COLLATE NOCASE
                      OR cert.verification_code LIKE ? COLLATE NOCASE
                      OR u.email LIKE ? COLLATE NOCASE
                      OR COALESCE(sp.display_name, sp.full_name) LIKE ? COLLATE NOCASE)`);
    const term = `%${filters.q}%`;
    params.push(term, term, term, term);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = await db.count(
    `SELECT COUNT(*) AS total
       FROM certificates cert
       JOIN users u ON u.id = cert.user_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       ${where}`,
    params,
  );

  const items = await db.all<CertificateDetailRow>(
    `${CERTIFICATE_DETAIL_SELECT} ${where} ORDER BY cert.issued_at DESC LIMIT ? OFFSET ?`,
    [...params, filters.perPage, (filters.page - 1) * filters.perPage],
  );

  return { items, total };
}

export async function revokeCertificate(
  db: Db,
  certificateId: string,
  reason: string,
): Promise<number> {
  const now = new Date().toISOString();
  return db.changes(
    `UPDATE certificates SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL`,
    [now, reason, certificateId],
  );
}

export interface CertificateStats {
  total: number;
  issuedLast30Days: number;
  revoked: number;
}

export async function certificateStats(db: Db): Promise<CertificateStats> {
  const row = await db.first<{ total: number; recent: number; revoked: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN issued_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days') THEN 1 ELSE 0 END) AS recent,
            SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked
       FROM certificates`,
  );
  return {
    total: Number(row?.total ?? 0),
    issuedLast30Days: Number(row?.recent ?? 0),
    revoked: Number(row?.revoked ?? 0),
  };
}

/** Guards against an accidental duplicate across concurrent completions. */
export async function certificateExists(db: Db, userId: string, courseId: string): Promise<boolean> {
  return db.exists(`SELECT 1 AS found FROM certificates WHERE user_id = ? AND course_id = ? LIMIT 1`, [
    userId,
    courseId,
  ]);
}

export async function verificationCodeExists(db: Db, code: string): Promise<boolean> {
  return db.exists(`SELECT 1 AS found FROM certificates WHERE verification_code = ? LIMIT 1`, [code]);
}

export async function certificateNumberExists(db: Db, number: string): Promise<boolean> {
  return db.exists(`SELECT 1 AS found FROM certificates WHERE certificate_number = ? LIMIT 1`, [number]);
}
