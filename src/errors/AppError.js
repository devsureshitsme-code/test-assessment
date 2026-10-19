/**
 * Base class for errors that are safe to expose to API clients.
 * Anything that is not an AppError is treated as unexpected and is
 * reported to clients as a generic 500.
 */
export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

/** The request is well-formed but conflicts with the resource's current state. */
export class ConflictError extends AppError {
  constructor(code = 'CONFLICT', message = 'Request conflicts with the current resource state', details) {
    super(409, code, message, details);
  }
}
