/**
 * Constant UNIQUE_VIOLATION
 *
 * @description
 * SQLSTATE of a unique violation.
 *
 * @type {string}
 */
const UNIQUE_VIOLATION: string = '23505';

/**
 * Function violatedUniqueConstraint
 *
 * @description
 * The unique constraint a failed statement violated, read from the `pg` error Drizzle wraps in the
 * `cause` of its own. A unique index is enforced whatever the row-level security, so a tenant
 * transaction learns that another organization holds a value without seeing its row.
 *
 * @param {unknown} error - What the statement threw.
 * @returns {string | null} The name of the constraint, or `null` for any other error.
 */
export function violatedUniqueConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let depth: number = 0; depth < 5 && current instanceof Error; depth += 1) {
    const { code, constraint } = current as Error & {
      readonly code?: unknown;
      readonly constraint?: unknown;
    };
    if (code === UNIQUE_VIOLATION) {
      return typeof constraint === 'string' ? constraint : null;
    }
    current = current.cause;
  }
  return null;
}
