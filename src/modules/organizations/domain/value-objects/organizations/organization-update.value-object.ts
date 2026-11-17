import type { Organization } from '../../aggregates/organization/organization.aggregate.js';
import type { OrganizationField } from './organization-field.value-object.js';

/**
 * Interface OrganizationUpdate
 *
 * @description
 * The organization after a change, and the members that moved; no member moved means nothing
 * changed, the version stays and no event is emitted.
 */
export interface OrganizationUpdate {
  // #region Properties
  /**
   * Property organization
   *
   * @description
   * The organization after the change: the same instance when nothing moved.
   *
   * @type {Organization}
   * @readonly
   */
  readonly organization: Organization;

  /**
   * Property changed
   *
   * @description
   * The members that moved, in the order of the profile.
   *
   * @type {readonly OrganizationField[]}
   * @readonly
   */
  readonly changed: readonly OrganizationField[];
  // #endregion
}
