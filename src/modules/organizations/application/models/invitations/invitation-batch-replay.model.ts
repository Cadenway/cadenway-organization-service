import type { InvitationBatchRequest } from '../../../domain/value-objects/invitations/invitation-batch-request.value-object.js';
import type { InvitationOutcome } from '../../projections/invitations/invitation-outcome.projection.js';

/**
 * Interface InvitationBatchReplay
 *
 * @description
 * A committed invitation batch to keep for its `Idempotency-Key`: the batch it answered, kept as a
 * fingerprint only, and its `200` outcome, replayed as is. Only a `200` is ever kept.
 */
export interface InvitationBatchReplay {
  // #region Properties
  /**
   * Property request
   *
   * @description
   * The batch the key commits.
   *
   * @type {InvitationBatchRequest}
   * @readonly
   */
  readonly request: InvitationBatchRequest;

  /**
   * Property invitations
   *
   * @description
   * The outcome of each distinct address.
   *
   * @type {readonly InvitationOutcome[]}
   * @readonly
   */
  readonly invitations: readonly InvitationOutcome[];
  // #endregion
}
