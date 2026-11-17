import type { OrganizationChange } from '../../../../../domain/value-objects/organizations/organization-change.value-object.js';
import type { VersionCondition } from '../../../../models/versions/version-condition.model.js';

/**
 * Interface UpdateOrganizationInput
 *
 * @description
 * A JSON Merge Patch of the organization of the request ("Enregistrer" in "Général").
 */
export interface UpdateOrganizationInput {
  // #region Properties
  /**
   * Property actorUserId
   *
   * @description
   * The user of the verified internal token.
   *
   * @type {string}
   * @readonly
   */
  readonly actorUserId: string;

  /**
   * Property organizationId
   *
   * @description
   * The organization of the verified internal token, never a value of the request.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationId: string;

  /**
   * Property change
   *
   * @description
   * The patch.
   *
   * @type {OrganizationChange}
   * @readonly
   */
  readonly change: OrganizationChange;

  /**
   * Property expectedVersion
   *
   * @description
   * The `If-Match` of the request.
   *
   * @type {VersionCondition}
   * @readonly
   */
  readonly expectedVersion: VersionCondition;
  // #endregion
}
