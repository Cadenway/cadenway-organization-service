import type { InvitationBatchRequest } from '../../../../../domain/value-objects/invitations/invitation-batch-request.value-object.js';
import type { InvitationBatchReplayKey } from '../../../../models/invitations/invitation-batch-replay-key.model.js';
import type { InvitationBatchReplay } from '../../../../models/invitations/invitation-batch-replay.model.js';
import type { StoredInvitationBatch } from '../../../../models/invitations/stored-invitation-batch.model.js';

/**
 * Interface InvitationBatchReplayRepository
 *
 * @description
 * The replay records of the invitation batches sent with an `Idempotency-Key`, bound to the tenant
 * transaction of the batch: the record commits with the invitations and their outbox rows, or not
 * at all. A record keeps a fingerprint of its batch, never its addresses, and the `200` body to
 * replay, which lists them, until it expires. Its replay window (`INVITATION_BATCH_REPLAY_MS`)
 * starts when the record is written and is read and purged on the same clock, the store's own, so
 * the time a batch waited on its locks never shortens it.
 */
export interface InvitationBatchReplayRepository {
  // #region Methods
  /**
   * Method findLive
   *
   * @description
   * The committed record of a key still replayed at the instant of the read, compared with the
   * batch of the request, with the actor's current role, or `null`. One statement, one snapshot,
   * no row lock: a membership locked by a role change or a removal in progress never makes the
   * read wait.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @returns {Promise<StoredInvitationBatch | null>} The record.
   */
  findLive(
    key: InvitationBatchReplayKey,
    request: InvitationBatchRequest,
  ): Promise<StoredInvitationBatch | null>;

  /**
   * Method tryClaim
   *
   * @description
   * Marks the key and the batch as in progress for the rest of the transaction, without waiting, so
   * no request holds a pooled connection while another batch runs. Only an equivalent batch under
   * the same key contends; another batch under it does not. The marker lives exactly as long as the
   * transaction: it goes with its commit or rollback, and with its connection when the process
   * stops, so a crashed request never holds the key.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @returns {Promise<boolean>} `false` when another transaction runs the same batch with the key.
   */
  tryClaim(key: InvitationBatchReplayKey, request: InvitationBatchRequest): Promise<boolean>;

  /**
   * Method record
   *
   * @description
   * Drops the expired record of the key and a few other expired records of the organization (a
   * bounded number, so the batch never holds its locks for a long delete), then stores the record
   * of the key, replayed for `INVITATION_BATCH_REPLAY_MS` from the instant it is written. The unique
   * key of the table decides between two transactions that both reached this point with the same
   * key: the second stores nothing.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchReplay} replay - The batch and its outcome.
   * @returns {Promise<boolean>} `false` when a record of the key already exists.
   */
  record(key: InvitationBatchReplayKey, replay: InvitationBatchReplay): Promise<boolean>;
  // #endregion
}
