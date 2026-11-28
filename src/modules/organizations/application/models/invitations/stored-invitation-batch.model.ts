import type { InvitationOutcome } from '../../projections/invitations/invitation-outcome.projection.js';

/**
 * Interface StoredInvitationBatch
 *
 * @description
 * The live replay record of a key, compared with the batch of the request.
 */
export interface StoredInvitationBatch {
  // #region Properties
  /**
   * Property sameRequest
   *
   * @description
   * Whether the batch of the request is equivalent to the one the key committed: their
   * fingerprints are equal.
   *
   * @type {boolean}
   * @readonly
   */
  readonly sameRequest: boolean;

  /**
   * Property invitations
   *
   * @description
   * The outcome of each distinct address, as first answered.
   *
   * @type {readonly InvitationOutcome[]}
   * @readonly
   */
  readonly invitations: readonly InvitationOutcome[];
  // #endregion
}
