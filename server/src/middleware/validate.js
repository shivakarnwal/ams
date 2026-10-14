import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';

export const zodToErrors = (err) => {
  const out = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || 'body';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
};

/** validate(schema, 'body' | 'query') — replaces req[source] with the parsed value. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  try {
    const parsed = schema.parse(req[source] ?? {});
    if (source === 'query') {
      Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
    } else {
      req[source] = parsed;
    }
    next();
  } catch (err) {
    if (err instanceof ZodError) return next(new ApiError(422, 'Validation failed', zodToErrors(err)));
    next(err);
  }
};
