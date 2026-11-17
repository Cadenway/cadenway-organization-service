import { parseIfMatch, ProblemException } from '@cadenway/nest-common';
import type { IfMatchCondition } from '@cadenway/nest-common';

import type { VersionCondition } from '../../../../application/models/versions/version-condition.model.js';

/**
 * Function toVersionCondition
 *
 * @description
 * Reads the optional `If-Match` header of a change (`"<version>"`, as the `ETag` gave it) with the
 * parser of the kit. A header that is not a list of entity tags answers `400 request.invalid`, the
 * code the contract declares for a request that does not match it.
 *
 * @param {string | undefined} header - The `If-Match` header.
 * @returns {VersionCondition} The versions the change was made from, `any` or `null`.
 * @throws {ProblemException} `400 request.invalid` for a malformed header.
 */
export function toVersionCondition(header: string | undefined): VersionCondition {
  let condition: IfMatchCondition;
  try {
    condition = parseIfMatch(header);
  } catch {
    throw new ProblemException({
      status: 400,
      code: 'request.invalid',
      detail: 'The request does not match its contract.',
      details: {
        issues: [
          {
            in: 'header',
            path: 'If-Match',
            code: 'invalid_format',
            message: 'Expected a list of entity tags.',
          },
        ],
      },
    });
  }
  if (condition === undefined) {
    return null;
  }
  return condition === '*' ? 'any' : condition;
}
