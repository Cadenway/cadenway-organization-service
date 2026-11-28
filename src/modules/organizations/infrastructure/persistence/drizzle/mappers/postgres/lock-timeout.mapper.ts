/**
 * Constant LOCK_NOT_AVAILABLE
 *
 * @description
 * SQLSTATE PostgreSQL raises when a lock wait reaches `lock_timeout`.
 *
 * @type {string}
 */
const LOCK_NOT_AVAILABLE: string = '55P03';

/**
 * Function isLockTimeout
 *
 * @description
 * Whether an error, or one of the errors it wraps (Drizzle wraps the driver's), is a lock wait that
 * reached `lock_timeout`.
 *
 * @param {unknown} error - What a query threw.
 * @returns {boolean} `true` for a lock timeout.
 */
export function isLockTimeout(error: unknown): boolean {
  let current: unknown = error;
  for (let depth: number = 0; depth < 5 && current instanceof Error; depth += 1) {
    if ((current as Error & { readonly code?: unknown }).code === LOCK_NOT_AVAILABLE) {
      return true;
    }
    current = current.cause;
  }
  return false;
}
