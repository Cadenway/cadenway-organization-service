import { z } from 'zod';

/**
 * Function listParameter
 *
 * @description
 * Reads a query parameter declared as an array with `style: form, explode: false` by the contract
 * (`role=owner,admin`): its comma-separated values, also when the parameter is repeated, before the
 * schema of the contract validates them.
 *
 * @param {TSchema} schema - The schema of the parameter, from `@cadenway/contracts`.
 * @returns {z.ZodType<z.output<TSchema>>} The schema of the raw parameter.
 */
export function listParameter<TSchema extends z.ZodType>(
  schema: TSchema,
): z.ZodType<z.output<TSchema>> {
  return z.preprocess((value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.split(',');
    }
    if (Array.isArray(value) && value.every((item: unknown) => typeof item === 'string')) {
      return value.flatMap((item: string): string[] => item.split(','));
    }
    return value;
  }, schema);
}
