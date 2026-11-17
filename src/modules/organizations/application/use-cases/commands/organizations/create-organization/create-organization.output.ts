import type { InvitationOutcome } from '../../../../projections/invitations/invitation-outcome.projection.js';
import type { OrganizationView } from '../../../../projections/organizations/organization-view.projection.js';

/**
 * Interface CreateOrganizationOutput
 *
 * @description
 * The new organization, read by its owner, and the outcome of each invited address
 * (`OrganizationCreated` of the contract).
 */
export interface CreateOrganizationOutput {
  // #region Properties
  /**
   * Property organization
   *
   * @description
   * The new organization.
   *
   * @type {OrganizationView}
   * @readonly
   */
  readonly organization: OrganizationView;

  /**
   * Property invitations
   *
   * @description
   * One outcome per distinct invited address, in their order.
   *
   * @type {readonly InvitationOutcome[]}
   * @readonly
   */
  readonly invitations: readonly InvitationOutcome[];
  // #endregion
}
