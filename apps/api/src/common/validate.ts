import { z } from 'zod';
import { AppError } from './app-error';

/** Parse a request body with a zod schema, or throw VALIDATION_FAILED with per-field messages. */
export function validate<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw new AppError('VALIDATION_FAILED', 'Some fields are invalid.', { fields });
}
