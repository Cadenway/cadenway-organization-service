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
