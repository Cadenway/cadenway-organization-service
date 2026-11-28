import type { InvitationBatchRequest } from '../../../../../domain/value-objects/invitations/invitation-batch-request.value-object.js';
import type { KeyedInvitationBatchUsage } from '../../../../../domain/value-objects/invitations/keyed-invitation-batch-usage.value-object.js';
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
   * Method lockReservations
   *
   * @description
   * Serializes the reservations of the organization until the end of the transaction, so that the
   * check of its replay record budget and the reservation of a key are one step: first the
   * `for key share` lock on the organization that the reservation's foreign key needs, then a
   * transaction lock on the organization's reservations, both under the normal lock timeout of
   * the role. Only reservation steps take the second one, never a running batch. To call before
   * `usage` and `reserve`, in their transaction.
   *
   * @param {string} organizationId - The organization of the transaction.
   * @returns {Promise<void>} Resolves once both locks are held.
   */
  lockReservations(organizationId: string): Promise<void>;

  /**
   * Method usage
   *
   * @description
   * What the organization holds of its replay record budget, read up to the budget only: its
   * reservations that may still commit (under a live lease, or past it while their batch still
   * runs), then the expiries of its newest records still inside their 24 hours, no more than the
   * places the reservations leave (`keyedInvitationBatchStoredToRead`). First deletes, in the
   * transaction, the reservations past their lease that no batch holds any longer, without
   * waiting, so their holders can no longer commit once the admission does. Index-backed and
   * O(budget) whatever the organization holds.
   *
   * @param {string} organizationId - The organization of the transaction.
   * @param {number} budget - The replay record budget.
   * @returns {Promise<KeyedInvitationBatchUsage>} The usage, on the clock of the store.
   */
  usage(organizationId: string, budget: number): Promise<KeyedInvitationBatchUsage>;

  /**
   * Method isReserved
   *
   * @description
   * Whether the key still has a reservation, whatever its lease, read without a lock. Called after
   * `usage` in the same transaction, it tells a batch of the key that still runs past its lease.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @returns {Promise<boolean>} `true` while a batch of the key may still commit.
   */
  isReserved(key: InvitationBatchReplayKey): Promise<boolean>;

  /**
   * Method reserve
   *
   * @description
   * Reserves the key for the batch, with a lease of `INVITATION_BATCH_LEASE_MS`, unless a live
   * reservation or record of the key exists; a row whose time ran out (a crashed holder's lease, an
   * expired record) is taken over. One atomic statement, decided by the primary key: of two
   * requests that reserve one key, the second answers once the first's transaction ends. Runs
   * after `lockReservations`, in the same transaction.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @returns {Promise<string | null>} The id of the lease, or `null` when the key is live.
   */
  reserve(key: InvitationBatchReplayKey, request: InvitationBatchRequest): Promise<string | null>;

  /**
   * Method renew
   *
   * @description
   * Renews the lease of `leaseId` and holds its reservation for the rest of the transaction of the
   * batch, so that neither a takeover nor a purge can take it while the batch runs, however long.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {string} leaseId - The lease the batch holds.
   * @returns {Promise<boolean>} `false` when the lease is no longer the batch's.
   */
  renew(key: InvitationBatchReplayKey, leaseId: string): Promise<boolean>;

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
