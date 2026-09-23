/**
 * Error contract (BRD §6 + OpenAPI `Error`):
 *   { error: { code, message, details?, gate?, requestId } }
 * Status mapping is fixed here; every route goes through `toErrorResponse`.
 */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  SESSION_REPLACED: 401,
  DEVICE_VERIFICATION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  GATE_NOT_MET: 409,
  SEAT_LIMIT: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly gate?: string;

  constructor(code: ErrorCode, message: string, opts: { details?: Record<string, unknown>; gate?: string; cause?: unknown } = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = opts.details;
    this.gate = opts.gate;
  }
}

export const errors = {
  validation: (message: string, details?: Record<string, unknown>) => new AppError("VALIDATION_FAILED", message, { details }),
  unauthenticated: (message = "Sign in required") => new AppError("UNAUTHENTICATED", message),
  sessionReplaced: () => new AppError("SESSION_REPLACED", "Signed in elsewhere; this session has ended"),
  deviceVerification: (details?: Record<string, unknown>) => new AppError("DEVICE_VERIFICATION_REQUIRED", "New device: verify the emailed code", { details }),
  forbidden: (message = "Not allowed for this role") => new AppError("FORBIDDEN", message),
  notFound: (what = "Record") => new AppError("NOT_FOUND", `${what} not found`),
  versionConflict: (expected: number, actual: number) => new AppError("VERSION_CONFLICT", `Case version is ${actual}; If-Match was ${expected}`, { details: { expected, actual } }),
  gate: (gate: string, message: string, details?: Record<string, unknown>) => new AppError("GATE_NOT_MET", message, { gate, details }),
  seatLimit: (role: string) => new AppError("SEAT_LIMIT", `Seat cap reached for ${role}`, { details: { role } }),
  idempotencyReused: () => new AppError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used with a different request body"),
  rateLimited: (message = "Too many requests", details?: Record<string, unknown>) => new AppError("RATE_LIMITED", message, { details }),
  internal: (message = "Unexpected error", cause?: unknown) => new AppError("INTERNAL", message, { cause }),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Map PostgreSQL errors raised by constraints/triggers/RLS into API errors. */
export function fromPgError(e: unknown): AppError | undefined {
  // drizzle wraps the driver error: DrizzleQueryError { cause: PostgresError }
  let err = e as { code?: string; message?: string; constraint_name?: string; constraint?: string; detail?: string; cause?: unknown };
  for (let i = 0; i < 4 && err && typeof err.code !== "string" && err.cause; i++) err = err.cause as typeof err;
  if (!err || typeof err.code !== "string") return undefined;
  const constraint = err.constraint_name ?? err.constraint;
  switch (err.code) {
    case "23505": // unique_violation
      return new AppError("VALIDATION_FAILED", uniqueMessage(constraint, err.detail), { details: { constraint } });
    case "23514": // check_violation (also our triggers)
      return new AppError("VALIDATION_FAILED", err.message ?? "Constraint failed", { details: { constraint } });
    case "23503": // foreign_key_violation
      return new AppError("VALIDATION_FAILED", "Referenced record does not belong to this case or does not exist", { details: { constraint } });
    case "23502": // not_null_violation
      return new AppError("VALIDATION_FAILED", err.message ?? "Missing required value");
    case "42501": // insufficient_privilege (RLS WITH CHECK or revoked grant)
      return new AppError("FORBIDDEN", "This change is not permitted");
    case "P0001": // raise_exception
      return new AppError("VALIDATION_FAILED", err.message ?? "Rejected by the database");
    default:
      return undefined;
  }
}

function uniqueMessage(constraint: string | undefined, detail: string | undefined) {
  switch (constraint) {
    case "one_open_case_per_customer":
      return "This customer already has an open case";
    case "customers_tenant_id_mobile_e164_key":
      return "A customer with this mobile already exists";
    case "one_active_quote":
      return "The case already has an ACTIVE quote";
    case "one_live_offer":
      return "The case already has a live offer";
    case "one_live_otp":
      return "An OTP is already pending for this offer";
    case "one_open_draft":
      return "A calculator draft is already open";
    case "one_published_release":
      return "A calculator release is already published";
    case "one_open_assignment":
      return "The case already has an open assignment";
    case "one_open_withdrawal":
      return "A withdrawal is already pending";
    case "one_open_financing":
      return "A financing decision is already pending";
    default:
      return detail ? `Duplicate: ${detail}` : "Duplicate record";
  }
}
