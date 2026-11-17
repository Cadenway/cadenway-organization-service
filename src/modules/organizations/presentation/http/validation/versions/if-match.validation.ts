import { parseIfMatch } from '@cadenway/nest-common';
import type { IfMatchCondition } from '@cadenway/nest-common';

import type { VersionCondition } from '../../../../application/models/versions/version-condition.model.js';

/**
 * Function toVersionCondition
 *
 * @description
 * Reads the optional `If-Match` header of a change (`"<version>"`, as the `ETag` gave it) with the
 * parser of the kit, which answers a header that is not a list of entity tags with
 * `400 request.invalid` and one issue on `If-Match`, the code the contract declares for a request
 * that does not match it.
 *
 * @param {string | undefined} header - The `If-Match` header.
 * @returns {VersionCondition} The versions the change was made from, `any` or `null`.
 * @throws {ProblemException} `400 request.invalid` for a malformed header, from the kit.
 */
export function toVersionCondition(header: string | undefined): VersionCondition {
  const condition: IfMatchCondition = parseIfMatch(header);
  if (condition === undefined) {
    return null;
  }
  return condition === '*' ? 'any' : condition;
}
