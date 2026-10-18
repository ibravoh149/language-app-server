/**
 * Error codes are part of the public API contract (docs/api/*.md).
 * Add new codes there first.
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'CODE_INVALID'
  | 'CODE_EXPIRED'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'REFRESH_INVALID'
  | 'OAUTH_TOKEN_INVALID'
  | 'EMAIL_NOT_VERIFIED'
  | 'NOT_FOUND'
  | 'EMAIL_TAKEN'
  | 'ACCOUNT_USES_SOCIAL'
  | 'SESSION_ENDED'
  | 'RATE_LIMITED'
  | 'TUTOR_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  CODE_INVALID: 400,
  CODE_EXPIRED: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  REFRESH_INVALID: 401,
  OAUTH_TOKEN_INVALID: 401,
  EMAIL_NOT_VERIFIED: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  ACCOUNT_USES_SOCIAL: 409,
  SESSION_ENDED: 409,
  RATE_LIMITED: 429,
  TUTOR_UNAVAILABLE: 502,
  INTERNAL: 500,
};

/** Throw this from anywhere; the global filter renders the contract's error envelope. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly options: { fields?: Record<string, string>; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.status = STATUS[code];
  }
}
