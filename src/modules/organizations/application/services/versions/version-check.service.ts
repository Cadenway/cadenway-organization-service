import { OrganizationRefusal } from '../../models/refusals/organization-refusal.model.js';
import type { VersionCondition } from '../../models/versions/version-condition.model.js';

/**
 * Function assertVersionMatches
 *
 * @description
 * Checks the `If-Match` of a change against the stored version, inside the transaction that
 * writes: an absent header or `*` accepts any version; otherwise the stored version must be one of
 * those listed.
 *
 * @param {VersionCondition} condition - The `If-Match` of the request.
 * @param {number} currentVersion - The stored version.
 * @throws {OrganizationRefusal} `version-mismatch` with the stored version.
 */
export function assertVersionMatches(condition: VersionCondition, currentVersion: number): void {
  if (condition === null || condition === 'any' || condition.includes(currentVersion)) {
    return;
  }
  throw new OrganizationRefusal({ reason: 'version-mismatch', version: currentVersion });
}
