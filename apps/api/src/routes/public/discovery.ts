/**
 * Routes — public search, statistics and verification.
 *
 * `/search` is a substring search across published courses, subjects,
 * departments and preview lessons. Its honest limitation (no ranking, no fuzzy
 * matching) and the FTS5 upgrade path are documented in docs/09.
 *
 * `/verify` is the endpoint a QR scan or a manual code entry lands on. It answers
 * "is this certificate/student code genuine?" without exposing private data: the
 * holder's display name and student number only, and never an email address,
 * progress, or any other learner's information.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import { searchQuerySchema } from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as catalogRepo from '../../db/repositories/catalog.js';
import * as certificateRepo from '../../db/repositories/certificates.js';
import * as qrRepo from '../../db/repositories/qr.js';
import * as usersRepo from '../../db/repositories/users.js';
import * as analyticsRepo from '../../db/repositories/analytics.js';
import * as enrollmentRepo from '../../db/repositories/enrollments.js';
import { normalizeSearchTerm } from '../../lib/text.js';
import { notFound } from '../../lib/errors.js';
import { parseParam, parseQuery } from '../../middleware/validate.js';
import { ok } from '../helpers.js';
import { toPublicVerificationDto } from '../../schemas/mappers.js';
import { audit } from '../../services/audit.js';

export const discoveryRoutes = new Hono<AppEnv>();

const codeSchema = z.string().trim().min(3).max(120);

/* --------------------------------- search --------------------------------- */

discoveryRoutes.get('/search', async (c) => {
  const db = createDb(c.env.DB);
  const query = parseQuery(c, searchQuerySchema);
  const term = normalizeSearchTerm(query.q);

  if (!term) {
    return ok(c, { items: [], query: query.q, total: 0 }, { notices: ['Enter at least two characters.'] });
  }

  const types =
    query.type === 'all'
      ? (['course', 'subject', 'department', 'lesson'] as const)
      : ([query.type] as const);

  const hits = await catalogRepo.search(db, term, types, 40);
  const page = query.page;
  const perPage = query.per_page;
  const start = (page - 1) * perPage;

  return ok(c, {
    query: query.q,
    items: hits.slice(start, start + perPage),
    total: hits.length,
  });
});

/* ------------------------------- statistics ------------------------------- */

discoveryRoutes.get('/stats', async (c) => {
  const db = createDb(c.env.DB);
  const stats = await analyticsRepo.publicStats(db);
  return ok(c, stats);
});

/* ------------------------------ verification ------------------------------ */

/**
 * Certificate verification by code (QR payload code, verification code or
 * certificate number). Deliberately public: a certificate is only meaningful if
 * anyone holding the document can check it.
 */
discoveryRoutes.get('/verify/certificate/:code', async (c) => {
  const db = createDb(c.env.DB);
  const code = parseParam(c, 'code', codeSchema);

  const certificate = await certificateRepo.findCertificateByCode(db, code);
  if (!certificate) throw notFound('No certificate matches that code');

  await audit(c, {
    action: 'certificate.verified',
    entityType: 'certificate',
    entityId: certificate.id,
    description: 'Certificate verified via public endpoint',
  });

  return ok(c, toPublicVerificationDto(certificate));
});

/**
 * Student identity verification. Returns the learner's display name, student
 * number and enrollment counts — the same information printed on a physical
 * student card — and nothing else.
 */
discoveryRoutes.get('/verify/student/:code', async (c) => {
  const db = createDb(c.env.DB);
  const code = parseParam(c, 'code', codeSchema);

  const qr = await qrRepo.findQrByCode(db, code);
  const now = new Date().toISOString();
  const usable = qr && !qr.revoked_at && (!qr.expires_at || qr.expires_at > now);

  if (usable && qr.kind === 'student_id') {
    const student = await usersRepo.findSummaryById(db, qr.user_id);
    if (!student) throw notFound('No learner matches that code');

    await qrRepo.recordQrScan(db, qr.id);
    await audit(c, {
      action: 'qr.looked_up',
      entityType: 'user',
      entityId: qr.user_id,
      description: 'Student identity code verified',
    });

    const enrollments = await enrollmentRepo.listEnrollmentsForUser(db, qr.user_id);

    return ok(c, {
      type: 'student_identity' as const,
      valid: true,
      student_number: student.student_number,
      display_name: student.display_name,
      status: student.status,
      member_since: student.created_at,
      courses: {
        enrolled: enrollments.length,
        completed: enrollments.filter((row) => row.status === 'completed').length,
      },
      code: { kind: qr.kind, created_at: qr.created_at },
    });
  }

  // A certificate QR opens the certificate verification instead.
  if (usable && qr.kind === 'certificate' && qr.certificate_id) {
    const certificate = await certificateRepo.findCertificateById(db, qr.certificate_id);
    if (certificate) {
      await qrRepo.recordQrScan(db, qr.id);
      return ok(c, toPublicVerificationDto(certificate));
    }
  }

  const byStudentNumber = await usersRepo.findSummaryByStudentNumber(db, code);
  if (byStudentNumber) {
    return ok(c, {
      type: 'student_identity' as const,
      valid: true,
      student_number: byStudentNumber.student_number,
      display_name: byStudentNumber.display_name,
      status: byStudentNumber.status,
      member_since: byStudentNumber.created_at,
      courses: { enrolled: 0, completed: 0 },
      code: null,
    });
  }

  throw notFound('That code is not recognised, or it has been revoked');
});
