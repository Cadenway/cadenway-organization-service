import { decodeCursor, encodeCursor, ProblemException } from '@cadenway/nest-common';
import type { CursorPosition } from '@cadenway/nest-common';

import type { PagePosition } from '../../../../application/models/pagination/page-position.model.js';

/**
 * Constant UUID_FORMAT
 *
 * @description
 * The form of the id a position carries: every id of this service is a UUID.
 *
 * @type {RegExp}
 */
const UUID_FORMAT: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Function invalidCursor
 *
 * @description
 * The refusal of a cursor this service did not issue for the same list: `400 request.invalid`, the
 * one code `openapi/internal/organization-service.yaml` declares for a request that does not match
 * it (the kit's own code, `pagination.cursor-invalid`, is not part of the contract).
 *
 * @returns {ProblemException} The problem.
 */
function invalidCursor(): ProblemException {
  return new ProblemException({
    status: 400,
    code: 'request.invalid',
    detail: 'The request does not match its contract.',
    details: {
      issues: [
        {
          in: 'query',
          path: 'cursor',
          code: 'invalid_cursor',
          message: 'Expected the nextCursor of a previous page of this list.',
        },
      ],
    },
  });
}

/**
 * Function toPagePosition
 *
 * @description
 * Reads the opaque `cursor` of a list: the position of the last item of the previous page, issued
 * for the same filters. A cursor is not signed, so its id must be a UUID and its key pass the check
 * of the list before either reaches a query.
 *
 * @param {string | undefined} cursor - The `cursor` query parameter.
 * @param {unknown} filters - Everything that defines the list.
 * @param {(key: string) => boolean} isKey - Whether a key has the form of the sort key of the list.
 * @returns {PagePosition | null} Where the page starts, or `null` for the first page.
 * @throws {ProblemException} `400 request.invalid` for a malformed or foreign cursor.
 */
export function toPagePosition(
  cursor: string | undefined,
  filters: unknown,
  isKey: (key: string) => boolean = (): boolean => true,
): PagePosition | null {
  if (cursor === undefined) {
    return null;
  }
  let position: CursorPosition;
  try {
    position = decodeCursor(cursor, filters);
  } catch {
    throw invalidCursor();
  }
  const [key] = position.sort;
  if (
    position.sort.length !== 1 ||
    typeof key !== 'string' ||
    !isKey(key) ||
    !UUID_FORMAT.test(position.id)
  ) {
    throw invalidCursor();
  }
  return { key, id: position.id };
}

/**
 * Function isInstant
 *
 * @description
 * The check of a sort key that is an instant in ISO 8601, as the invitation lists sort by sending.
 *
 * @param {string} key - The key of a cursor.
 * @returns {boolean} Whether it is an instant.
 */
export function isInstant(key: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u.test(key) &&
    !Number.isNaN(Date.parse(key))
  );
}

/**
 * Function toNextCursor
 *
 * @description
 * The opaque `nextCursor` of a page.
 *
 * @param {PagePosition | null} next - Where the next page starts, or `null` on the last page.
 * @param {unknown} filters - Everything that defines the list.
 * @returns {string | null} The cursor, or `null`.
 */
export function toNextCursor(next: PagePosition | null, filters: unknown): string | null {
  return next === null ? null : encodeCursor({ sort: [next.key], id: next.id }, filters);
}
