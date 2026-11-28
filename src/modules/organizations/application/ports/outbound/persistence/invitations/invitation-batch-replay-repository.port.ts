import type { InvitationBatchRequest } from '../../../../../domain/value-objects/invitations/invitation-batch-request.value-object.js';
import type { InvitationBatchReplayKey } from '../../../../models/invitations/invitation-batch-replay-key.model.js';
import type { InvitationBatchReplay } from '../../../../models/invitations/invitation-batch-replay.model.js';
import type { StoredInvitationBatch } from '../../../../models/invitations/stored-invitation-batch.model.js';

/**
 * Interface InvitationBatchReplayRepository
 *
 * @description
 * The keys of the invitation batches sent with an `Idempotency-Key`: first a reservation, taken
 * and committed in a short transaction of its own before the batch runs, then, in the transaction
 * of the batch, the record of its `200` outcome, replayed for 24 hours. A record keeps a fingerprint
 * of its batch, never its addresses, and the body to replay, which lists them, until it expires.
 * Every instant is read on the clock of the store, at the moment of the statement.
 */
export interface InvitationBatchReplayRepository {
  // #region Methods
  /**
   * Method findLive
   *
   * @description
   * The live reservation or record of a key, compared with the batch of the request, with the
   * actor's current role, or `null`. One statement, one snapshot, no row lock: a membership locked
   * by a role change or a removal in progress never makes the read wait.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @returns {Promise<StoredInvitationBatch | null>} The reservation or record.
   */
  findLive(
    key: InvitationBatchReplayKey,
    request: InvitationBatchRequest,
  ): Promise<StoredInvitationBatch | null>;

  /**
   * Method reserve
   *
   * @description
   * Reserves the key for the batch, with a lease of `INVITATION_BATCH_LEASE_MS`, unless a live
   * reservation or record of the key exists; a row whose time ran out (a crashed holder's lease, an
   * expired record) is taken over. One atomic statement, decided by the primary key: of two
   * requests that reserve one key, the second answers once the first's transaction ends.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @returns {Promise<string | null>} The id of the lease, or `null` when the key is live.
   */
  reserve(key: InvitationBatchReplayKey, request: InvitationBatchRequest): Promise<string | null>;

  /**
   * Method complete
   *
   * @description
   * Turns the reservation of `leaseId` into the record of the batch, replayed for
   * `INVITATION_BATCH_REPLAY_MS` from now, in the transaction of the batch; first deletes a bounded
   * number of expired rows of the organization.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {string} leaseId - The lease the batch holds.
   * @param {InvitationBatchReplay} replay - The batch and its outcome.
   * @returns {Promise<boolean>} `false` when the lease is no longer the batch's (it ran out and was
   * taken over).
   */
  complete(
    key: InvitationBatchReplayKey,
    leaseId: string,
    replay: InvitationBatchReplay,
  ): Promise<boolean>;

  /**
   * Method release
   *
   * @description
   * Deletes the reservation of `leaseId`, so the key can run again at once; nothing when the lease
   * is no longer there.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {string} leaseId - The lease the batch held.
   * @returns {Promise<void>} Resolves once deleted.
   */
  release(key: InvitationBatchReplayKey, leaseId: string): Promise<void>;
  // #endregion
}
