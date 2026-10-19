import { AppError } from '../errors/AppError.js';

/**
 * Centralized error handler. Every error response in the API is produced
 * here so the response shape stays consistent:
 *
 *   { "error": { "code": string, "message": string, "details"?: array } }
 *
 * Only AppErrors and well-known client errors raised by body-parser have
 * their messages forwarded to clients. Everything else becomes a generic 500
 * so stack traces, file paths and environment details are never leaked.
 */
export function createErrorHandler({ env = process.env.NODE_ENV, logger = console } = {}) {
  const isDevelopment = env === 'development';

  // Express identifies error handlers by their arity, so all four params are required.
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, _next) {
    if (res.headersSent) {
      // Let Express close the connection; we can no longer send a JSON body.
      return _next(err);
    }

    const { status, body } = toErrorResponse(err);

    if (status >= 500) {
      logger.error(`[${req.method} ${req.originalUrl}]`, err);
      if (isDevelopment && err instanceof Error) {
        body.error.stack = err.stack;
      }
    }

    res.status(status).json(body);
  };
}

function toErrorResponse(err) {
  if (err instanceof AppError) {
    const error = { code: err.code, message: err.message };
    if (err.details !== undefined) error.details = err.details;
    return { status: err.statusCode, body: { error } };
  }

  // Errors raised by express.json() (body-parser).
  switch (err?.type) {
    case 'entity.parse.failed':
      return clientError(400, 'INVALID_JSON', 'Request body contains malformed JSON');
    case 'entity.too.large':
      return clientError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return clientError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported request body encoding');
    default:
      break;
  }

  // Other http-errors style client errors explicitly marked safe to expose.
  const status = err?.status ?? err?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500 && err.expose === true) {
    return clientError(status, 'BAD_REQUEST', 'Bad request');
  }

  return clientError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
}

function clientError(status, code, message) {
  return { status, body: { error: { code, message } } };
}
