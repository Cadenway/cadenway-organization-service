import type { InvitationBatchReplayKey } from '../../../../models/invitations/invitation-batch-replay-key.model.js';
import type { InvitationBatchReplay } from '../../../../models/invitations/invitation-batch-replay.model.js';

/**
 * Interface InvitationBatchReplayRepository
 *
 * @description
 * The replay records of the invitation batches sent with an `Idempotency-Key`, bound to the tenant
 * transaction of the batch: the record commits with the invitations and their outbox rows, or not
 * at all.
 */
export interface InvitationBatchReplayRepository {
  // #region Methods
  /**
   * Method tryClaim
   *
   * @description
   * Marks the key as in progress for the rest of the transaction, without waiting. The marker lives
   * exactly as long as the transaction: it goes with its commit or rollback, and with its connection
   * when the process stops, so a crashed request never holds the key.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @returns {Promise<boolean>} `false` when another transaction holds the key.
   */
  tryClaim(key: InvitationBatchReplayKey): Promise<boolean>;

  /**
   * Method findLive
   *
   * @description
   * The record of a key still replayed at `now`, or `null`.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {Date} now - The instant of the request.
   * @returns {Promise<InvitationBatchReplay | null>} The record.
   */
  findLive(key: InvitationBatchReplayKey, now: Date): Promise<InvitationBatchReplay | null>;

  /**
   * Method record
   *
   * @description
   * Drops the records of the organization that expired at `now`, then stores the record of the key,
   * replayed until `expiresAt`. The unique key of the table decides between two transactions that
   * both reached this point with the same key.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchReplay} replay - The batch and its outcome.
   * @param {{ readonly now: Date; readonly expiresAt: Date }} window - The instant of the batch and
   * the end of its replay.
   * @returns {Promise<boolean>} `false` when a record of the key already exists.
   */
  record(
    key: InvitationBatchReplayKey,
    replay: InvitationBatchReplay,
    window: { readonly now: Date; readonly expiresAt: Date },
  ): Promise<boolean>;
  // #endregion
}
