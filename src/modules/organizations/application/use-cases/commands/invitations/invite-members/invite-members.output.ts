import type { InvitationOutcome } from '../../../../projections/invitations/invitation-outcome.projection.js';

/**
 * Interface InviteMembersOutput
 *
 * @description
 * The outcome of each distinct address of a batch, in its order (`InvitationBatchResult`).
 */
export interface InviteMembersOutput {
  // #region Properties
  /**
   * Property invitations
   *
   * @description
   * One outcome per distinct address.
   *
   * @type {readonly InvitationOutcome[]}
   * @readonly
   */
  readonly invitations: readonly InvitationOutcome[];
  // #endregion
}
