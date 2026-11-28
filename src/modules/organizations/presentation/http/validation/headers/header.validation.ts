import { ProblemException } from '@cadenway/nest-common';
import type { z } from 'zod';

/**
 * Function validateHeaders
 *
 * @description
 * Validates request headers against the generated header schema of an operation, and answers a
 * mismatch with `400 request.invalid` and one issue per header, `in: 'header'`.
 *
 * @param {z.ZodType<TResult>} schema - The generated header validator of the operation.
 * @param {unknown} value - The headers, by their contract names.
 * @returns {TResult} The validated headers.
 * @throws {ProblemException} For a header the contract refuses.
 */
export function validateHeaders<TResult>(schema: z.ZodType<TResult>, value: unknown): TResult {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ProblemException({
    status: 400,
    code: 'request.invalid',
    details: {
      issues: result.error.issues.map((issue) => ({
        in: 'header',
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    },
  });
}
