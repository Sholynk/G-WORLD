/** Pure helpers; no remote side effects when imported by tests. */
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
export const OWNER_EMAIL = 'sholabusari66@gmail.com';

export function validateOwnerOrigin(value, remote) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Supply only the website origin, without credentials, a path, query or fragment.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !remote && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Use HTTPS (local development may use http://localhost).');
  }
  return url.origin;
}

export function ownerEnrollmentSql() {
  const id = `usr_${randomUUID().replaceAll('-', '')}`;
  const salt = randomBytes(16);
  const secret = randomBytes(48);
  const key = pbkdf2Sync(secret, salt, 100000, 32, 'sha256');
  secret.fill(0);
  const hash = `pbkdf2$sha256$100000$${salt.toString('base64')}$${key.toString('base64')}`;
  // All values are generated here, not caller input. The SQL trigger reserves
  // the fixed email and creates the account/profile atomically.
  return `INSERT INTO owner_enrollment(singleton, user_id, bootstrap_password_hash) VALUES (1, '${id}', '${hash}');\n`;
}
