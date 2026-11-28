import { InvitationKeyedBatchLimitReachedError } from '../../errors/invitations/invitation-keyed-batch-limit-reached.error.js';
import type { KeyedInvitationBatchUsage } from '../../value-objects/invitations/keyed-invitation-batch-usage.value-object.js';
import { INVITATION_BATCH_LEASE_MS } from './invitation-batch-replay.policy.js';

/**
 * Constant KEYED_INVITATION_BATCH_BUDGET
 *
 * @description
 * The replay record budget of an organization: at most 1,000 keyed invitation batches at once,
 * stored outcomes still inside their 24 hours plus running batches, across all its users and both
 * invitation routes (`openapi/internal/organization-service.yaml`, `inviteMembersKeyedInternal`,
 * "Replay record budget", which leaves the number to the service). Ten times the 100 batches that
 * send an email the daily allowance admits in 24 hours (`DAILY_INVITATION_EMAILS`), so a client
 * that retries, or sends batches whose addresses are all members or already invited, never meets
 * it in normal use, while the records an organization keeps, each of at most 50 addresses, stay
 * bounded (decision in `MODULE.md`).
 *
 * @type {number}
 */
export const KEYED_INVITATION_BATCH_BUDGET: number = 1_000;

/**
 * Constant KEYED_INVITATION_BATCH_RUNNING_DELAY_MS
 *
 * @description
 * How far `details.nextAvailableAt` lies when running batches alone fill the budget, so that no
 * expiry of a stored outcome can free a place: the lease of a reservation, 30 seconds, by which a
 * running batch has stored its outcome, ended without one or lost its place
 * (`inviteMembersKeyedInternal`: "within the lifetime of a running request").
 *
 * @type {number}
 */
export const KEYED_INVITATION_BATCH_RUNNING_DELAY_MS: number = INVITATION_BATCH_LEASE_MS;

/**
 * Function keyedInvitationBatchStoredToRead
 *
 * @description
 * How many of the newest stored outcomes decide the budget once `running` batches are counted:
 * the places the running batches leave, `0` when they fill it. Reading no more keeps the check
 * O(budget) whatever the organization holds.
 *
 * @param {number} budget - The replay record budget, `1` or more.
 * @param {number} running - The running batches counted, up to the budget.
 * @returns {number} The stored outcomes to read, newest first.
 */
export function keyedInvitationBatchStoredToRead(budget: number, running: number): number {
  return Math.max(0, budget - running);
}

/**
 * Function assertKeyedInvitationBatchAvailable
 *
 * @description
 * Refuses a keyed batch with a new key when its organization already holds `budget` keyed
 * batches, its stored outcomes plus its running batches (`invitation.keyed-batch-limit-reached`,
 * `inviteMembersKeyedInternal`). Admitting only below the budget, under the lock that serializes
 * the reservations of the organization, means its count never goes past it. `nextAvailableAt` is
 * the earliest instant the expiry of stored outcomes alone brings the count below the budget: the
 * expiry of the (count - budget + 1)-th oldest stored outcome, which is the (budget - running)-th
 * newest, so the newest `budget - running` outcomes decide it whatever the count. When running
 * batches alone fill the budget, it is `KEYED_INVITATION_BATCH_RUNNING_DELAY_MS` after the read.
 *
 * @param {number} budget - The replay record budget, `1` or more.
 * @param {KeyedInvitationBatchUsage} usage - What the organization holds, read up to the budget.
 * @throws {InvitationKeyedBatchLimitReachedError} When no place is left.
 */
export function assertKeyedInvitationBatchAvailable(
  budget: number,
  usage: KeyedInvitationBatchUsage,
): void {
  const needed: number = keyedInvitationBatchStoredToRead(budget, usage.running);
  if (needed === 0) {
    throw new InvitationKeyedBatchLimitReachedError(
      new Date(usage.readAt.getTime() + KEYED_INVITATION_BATCH_RUNNING_DELAY_MS),
    );
  }
  const newestFirst: number[] = usage.newestStoredExpiries
    .map((expiry: Date) => expiry.getTime())
    .sort((left: number, right: number) => right - left);
  const boundary: number | undefined = newestFirst[needed - 1];
  if (boundary === undefined) {
    // Fewer stored outcomes than the places the running batches leave: one is free.
    return;
  }
  throw new InvitationKeyedBatchLimitReachedError(new Date(boundary));
}
