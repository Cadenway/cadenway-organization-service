/**
 * Constant INVITATION_BATCH_REPLAY_MS
 *
 * @description
 * How long a committed invitation batch is replayed for its `Idempotency-Key`: 24 hours
 * (`inviteMembers` in `openapi/internal/organization-service.yaml`). Within it, an equivalent
 * batch (`InvitationBatchRequest.equals`) replays and another batch is refused
 * (`InvitationBatchKeyReusedError`); after it, the key runs a fresh batch.
 *
 * @type {number}
 */
export const INVITATION_BATCH_REPLAY_MS: number = 24 * 60 * 60_000;

/**
 * Constant INVITATION_BATCH_LEASE_MS
 *
 * @description
 * How long a reservation of a key holds while its batch runs: 30 seconds, beyond the
 * `statement_timeout` (10 s) and `idle_in_transaction_session_timeout` (30 s) that bound a batch's
 * transaction, so a live batch never loses its key, and a crashed one frees it within that time.
 *
 * @type {number}
 */
export const INVITATION_BATCH_LEASE_MS: number = 30_000;

/**
 * Function invitationBatchReplayExpiresAt
 *
 * @description
 * When the replay of a batch committed at `now` ends: from then on, the key runs a fresh batch.
 *
 * @param {Date} now - When the batch commits.
 * @returns {Date} The end of its replay.
 */
export function invitationBatchReplayExpiresAt(now: Date): Date {
  return new Date(now.getTime() + INVITATION_BATCH_REPLAY_MS);
}
