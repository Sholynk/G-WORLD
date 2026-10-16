/**
 * Service — student identity and certificate QR codes.
 *
 * One live `student_id` code per learner: `ensureStudentQr()` returns the existing
 * code or issues a new one, so a dashboard reload never accumulates codes. The
 * payload is a verification URL (`/verify.html?code=…`), not raw personal data,
 * so a scanned code reveals nothing until the public verification endpoint is
 * called — and that endpoint only returns public facts.
 */
import type { Db } from '../db/client.js';
import type { AppConfig } from '../env.js';
import * as qrRepo from '../db/repositories/qr.js';
import { buildVerificationUrl, renderQrSvg, type QrRenderOptions } from '../lib/qrcode.js';
import { qrCode as generateQrCode } from '../lib/ids.js';
import { expiresAtFromNow, TOKEN_TTL } from '../lib/tokens.js';

export interface StudentQrResult {
  code: string;
  payloadUrl: string;
  svg: string;
  created: boolean;
  scanCount: number;
}

export async function ensureStudentQr(
  db: Db,
  config: AppConfig,
  userId: string,
  options: QrRenderOptions & { label?: string } = {},
): Promise<StudentQrResult> {
  const existing = await qrRepo.findActiveStudentQr(db, userId);
  if (existing) {
    const rendered = renderQrSvg(existing.payload_url, {
      border: 2,
      label: options.label ?? `G WORLD student identity code ${existing.code}`,
      ...options,
    });
    return {
      code: existing.code,
      payloadUrl: existing.payload_url,
      svg: rendered.svg,
      created: false,
      scanCount: existing.scan_count,
    };
  }

  const code = generateQrCode('student');
  const payloadUrl = buildVerificationUrl(config.appBaseUrl, code);
  await qrRepo.createQrCode(db, {
    userId,
    code,
    kind: 'student_id',
    payloadUrl,
    expiresAt: expiresAtFromNow(TOKEN_TTL.QR_STUDENT_MS),
  });

  const rendered = renderQrSvg(payloadUrl, {
    border: 2,
    label: options.label ?? `G WORLD student identity code ${code}`,
    ...options,
  });

  return { code, payloadUrl, svg: rendered.svg, created: true, scanCount: 0 };
}

export interface CertificateQrResult {
  code: string;
  payloadUrl: string;
  svg: string;
}

export async function ensureCertificateQr(
  db: Db,
  config: AppConfig,
  input: { userId: string; certificateId: string; verificationCode: string },
): Promise<CertificateQrResult> {
  const existing = await qrRepo.findQrForCertificate(db, input.certificateId);
  const code = existing?.code ?? generateQrCode('cert');
  const payloadUrl = existing?.payload_url ?? buildVerificationUrl(config.appBaseUrl, input.verificationCode);

  if (!existing) {
    await qrRepo.createQrCode(db, {
      userId: input.userId,
      code,
      kind: 'certificate',
      certificateId: input.certificateId,
      payloadUrl,
    });
  }

  const rendered = renderQrSvg(payloadUrl, {
    border: 2,
    label: `Certificate verification code ${input.verificationCode}`,
  });

  return { code, payloadUrl, svg: rendered.svg };
}
