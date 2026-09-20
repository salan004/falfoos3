/**
 * Phase 7 — shared error type for the website integration services.
 * Carries a stable machine code plus the HTTP status the route should return.
 */
export class IntegrationError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, httpStatus: number, message?: string) {
    super(message || code);
    this.name = 'IntegrationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function isIntegrationError(err: unknown): err is IntegrationError {
  return err instanceof IntegrationError;
}
