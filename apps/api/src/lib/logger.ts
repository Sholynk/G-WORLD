/**
 * G WORLD — structured logger.
 *
 * Cloudflare captures `console.*` output and indexes it; emitting one JSON
 * object per line makes logs queryable (`wrangler tail`, Workers Logs) without
 * pulling in a logging dependency. Secrets, tokens and passwords are never
 * passed to the logger — callers pass identifiers and counts only.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Field names that must never reach the log stream. */
const REDACTED_KEYS = new Set([
  'password', 'new_password', 'current_password', 'password_hash', 'token', 'token_hash',
  'session_secret', 'api_key', 'authorization', 'cookie', 'set-cookie', 'answer_text',
  'submission_text', 'secret', 'resend_api_key', 'signature',
]);

export function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      out[key] = '[redacted]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redact(value as LogFields);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function createLogger(base: LogFields = {}, minLevel: LogLevel = 'debug'): Logger {
  const write = (level: LogLevel, message: string, fields: LogFields = {}) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const payload = JSON.stringify({
      level,
      message,
      time: new Date().toISOString(),
      ...redact(base),
      ...redact(fields),
    });
    if (level === 'error') console.error(payload);
    else if (level === 'warn') console.warn(payload);
    else console.log(payload);
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger({ ...base, ...fields }, minLevel),
  };
}
