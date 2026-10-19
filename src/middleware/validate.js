import { ValidationError } from '../errors/AppError.js';

/**
 * Validates request parts against Zod schemas. Parsed (and normalized)
 * values are exposed on `req.validated` so handlers never read raw input.
 *
 * @param {{ body?: import('zod').ZodType, params?: import('zod').ZodType, query?: import('zod').ZodType }} schemas
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const validated = {};
    const details = [];

    for (const [location, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[location]);
      if (result.success) {
        validated[location] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({
            location,
            field: issue.path.join('.') || null,
            message: issue.message,
          });
        }
      }
    }

    if (details.length > 0) {
      return next(new ValidationError('Request validation failed', details));
    }

    req.validated = validated;
    next();
  };
}
