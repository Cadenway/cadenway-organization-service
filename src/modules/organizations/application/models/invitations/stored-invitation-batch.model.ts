import type { Role } from '../../../domain/value-objects/members/role.value-object.js';
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

  /**
   * Property actorRole
   *
   * @description
   * The role of the acting user's active membership in the organization of the key, read in the
   * same statement as the record, without a lock, or `null` when the user is no longer a member.
   *
   * @type {Role | null}
   * @readonly
   */
  readonly actorRole: Role | null;
  // #endregion
}
