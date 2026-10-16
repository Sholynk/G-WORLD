/**
 * G WORLD — typed application errors.
 *
 * Handlers throw `AppError` subclasses; the error-handler middleware converts
 * them into the standard JSON error envelope with the right HTTP status. This
 * keeps handlers free of `c.json({...}, 403)` boilerplate and makes it obvious
 * which failures are expected (auth, validation, conflicts) versus bugs.
 */
import { ERROR_STATUS, type ApiErrorCode, type ApiErrorDetail } from '@g-world/shared';

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: ApiErrorDetail[];
  /** Extra fields for the log line — never returned to the client. */
  readonly logFields?: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { details?: ApiErrorDetail[]; logFields?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options.details;
    this.logFields = options.logFields;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export const badRequest = (message: string, details?: ApiErrorDetail[]) =>
  new AppError('VALIDATION_ERROR', message, { details });

export const unauthenticated = (message = 'Sign in to continue') =>
  new AppError('UNAUTHENTICATED', message);

export const sessionExpired = (message = 'Your session has expired. Please sign in again.') =>
  new AppError('SESSION_EXPIRED', message);

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError('FORBIDDEN', message);

export const notFound = (message = 'The requested resource was not found') =>
  new AppError('NOT_FOUND', message);

export const conflict = (message: string, details?: ApiErrorDetail[]) =>
  new AppError('CONFLICT', message, { details });

export const rateLimited = (retryAfterSeconds: number) =>
  new AppError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', {
    details: [{ message: `Retry after ${retryAfterSeconds} seconds` }],
    logFields: { retryAfterSeconds },
  });

export const invalidCredentials = () =>
  new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect');

export const emailNotVerified = () =>
  new AppError('EMAIL_NOT_VERIFIED', 'Please verify your email address before signing in');

export const accountSuspended = () =>
  new AppError('ACCOUNT_SUSPENDED', 'This account is suspended. Contact an administrator.');

export const accountLocked = (untilIso: string) =>
  new AppError('ACCOUNT_LOCKED', 'Too many failed sign-in attempts. This account is temporarily locked.', {
    details: [{ message: `Locked until ${untilIso}` }],
  });

export const featureDisabled = (feature: string) =>
  new AppError('FEATURE_DISABLED', `${feature} is currently disabled`);

export const dependencyUnavailable = (message = 'A required service is temporarily unavailable') =>
  new AppError('DEPENDENCY_UNAVAILABLE', message);

export const internalError = (cause?: unknown, logFields?: Record<string, unknown>) =>
  new AppError('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.', { cause, logFields });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
