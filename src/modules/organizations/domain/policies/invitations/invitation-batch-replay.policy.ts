import { InvitationBatchKeyReusedError } from '../../errors/invitations/invitation-batch-key-reused.error.js';
import type { InvitationBatchRequest } from '../../value-objects/invitations/invitation-batch-request.value-object.js';

/**
 * Constant INVITATION_BATCH_REPLAY_MS
 *
 * @description
 * How long a committed invitation batch is replayed for its `Idempotency-Key`: 24 hours
 * (`inviteMembers` in `openapi/internal/organization-service.yaml`).
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

/**
 * Function assertSameInvitationBatch
 *
 * @description
 * Allows the replay of a stored batch for an equivalent request only. A different batch under the
 * same key is refused (`422 idempotency.key-reused`); it never runs as a new batch.
 *
 * @param {InvitationBatchRequest} stored - The batch the key committed.
 * @param {InvitationBatchRequest} request - The batch sent again.
 * @returns {void}
 * @throws {InvitationBatchKeyReusedError} When the batches are not equivalent.
 */
export function assertSameInvitationBatch(
  stored: InvitationBatchRequest,
  request: InvitationBatchRequest,
): void {
  if (!stored.equals(request)) {
    throw new InvitationBatchKeyReusedError();
  }
}
