import type { InvitationBatchRequest } from '../../../domain/value-objects/invitations/invitation-batch-request.value-object.js';
import type { InvitationOutcome } from '../../projections/invitations/invitation-outcome.projection.js';

/**
 * Interface InvitationBatchReplay
 *
 * @description
 * A committed invitation batch kept for its `Idempotency-Key`: the batch it answered and its `200`
 * outcome, replayed as is. Only a `200` is ever kept.
 */
export interface InvitationBatchReplay {
  // #region Properties
  /**
   * Property request
   *
   * @description
   * The canonical batch the key committed.
   *
   * @type {InvitationBatchRequest}
   * @readonly
   */
  readonly request: InvitationBatchRequest;

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
