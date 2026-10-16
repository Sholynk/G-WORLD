/**
 * Repository — QR identity codes.
 *
 * A QR code row stores *what the code means* (kind + payload URL) and not an
 * image: the SVG is rendered on demand by lib/qrcode.ts. `scan_count` gives
 * administrators a lightweight usage signal without tracking individuals.
 */
import type { Db } from '../client.js';
import { newId, ID_PREFIXES } from '../../lib/ids.js';

export interface QrCodeRow {
  id: string;
  user_id: string;
  code: string;
  kind: 'student_id' | 'certificate';
  certificate_id: string | null;
  payload_url: string;
  scan_count: number;
  last_scanned_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateQrInput {
  userId: string;
  code: string;
  kind: 'student_id' | 'certificate';
  payloadUrl: string;
  certificateId?: string | null;
  expiresAt?: string | null;
}

export async function createQrCode(db: Db, input: CreateQrInput): Promise<string> {
  const id = newId(ID_PREFIXES.qr);
  await db.run(
    `INSERT INTO qr_codes (id, user_id, code, kind, certificate_id, payload_url, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.code,
      input.kind,
      input.certificateId ?? null,
      input.payloadUrl,
      input.expiresAt ?? null,
    ],
  );
  return id;
}

export async function findQrByCode(db: Db, code: string): Promise<QrCodeRow | null> {
  return db.first<QrCodeRow>(
    `SELECT id, user_id, code, kind, certificate_id, payload_url, scan_count, last_scanned_at,
            expires_at, revoked_at, created_at, updated_at
       FROM qr_codes
      WHERE code = ? COLLATE NOCASE
      LIMIT 1`,
    [code],
  );
}

/** The active student identity code for a user (one live code per learner). */
export async function findActiveStudentQr(db: Db, userId: string): Promise<QrCodeRow | null> {
  const now = new Date().toISOString();
  return db.first<QrCodeRow>(
    `SELECT id, user_id, code, kind, certificate_id, payload_url, scan_count, last_scanned_at,
            expires_at, revoked_at, created_at, updated_at
       FROM qr_codes
      WHERE user_id = ? AND kind = 'student_id' AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId],
  ).then((row) => {
    if (row?.expires_at && row.expires_at <= now) return null;
    return row;
  });
}

export async function findQrForCertificate(db: Db, certificateId: string): Promise<QrCodeRow | null> {
  return db.first<QrCodeRow>(
    `SELECT id, user_id, code, kind, certificate_id, payload_url, scan_count, last_scanned_at,
            expires_at, revoked_at, created_at, updated_at
       FROM qr_codes
      WHERE certificate_id = ? AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [certificateId],
  );
}

export async function recordQrScan(db: Db, id: string): Promise<void> {
  await db.run(
    `UPDATE qr_codes SET scan_count = scan_count + 1, last_scanned_at = ? WHERE id = ?`,
    [new Date().toISOString(), id],
  );
}

export async function revokeQrCode(db: Db, id: string, reason: string): Promise<number> {
  return db.changes(`UPDATE qr_codes SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL`, [
    new Date().toISOString(),
    reason,
    id,
  ]);
}

export async function revokeQrForUser(db: Db, userId: string, kind: 'student_id' | 'certificate'): Promise<number> {
  const now = new Date().toISOString();
  return db.changes(
    `UPDATE qr_codes SET revoked_at = ?, updated_at = ?
      WHERE user_id = ? AND kind = ? AND revoked_at IS NULL`,
    [now, now, userId, kind],
  );
}

export async function updateQrPayload(db: Db, id: string, payloadUrl: string): Promise<number> {
  return db.changes(`UPDATE qr_codes SET payload_url = ? WHERE id = ?`, [payloadUrl, id]);
}

export interface QrStats {
  total: number;
  scans: number;
}

export async function qrStats(db: Db): Promise<QrStats> {
  const row = await db.first<{ total: number; scans: number }>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(scan_count), 0) AS scans
       FROM qr_codes WHERE revoked_at IS NULL`,
  );
  return { total: Number(row?.total ?? 0), scans: Number(row?.scans ?? 0) };
}
