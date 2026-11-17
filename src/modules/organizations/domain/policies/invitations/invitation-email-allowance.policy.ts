import { InvitationDailyLimitReachedError } from '../../errors/invitations/invitation-daily-limit-reached.error.js';
import type { InvitationEmailUsage } from '../../value-objects/invitations/invitation-email-usage.value-object.js';

/**
 * Constant DAILY_INVITATION_EMAILS
 *
 * @description
 * The invitation emails an organization can cause in any 24 hours, issues and resends together
 * (decision 1 of the P2b security follow-ups, `openapi/internal/organization-service.yaml`).
 *
 * @type {number}
 */
export const DAILY_INVITATION_EMAILS: number = 100;

/**
 * Constant INVITATION_EMAIL_WINDOW_MS
 *
 * @description
 * The rolling window of the allowance: 24 hours, in milliseconds. An email counts from its sending
 * until the same instant one day later.
 *
 * @type {number}
 */
export const INVITATION_EMAIL_WINDOW_MS: number = 24 * 60 * 60_000;

/**
 * Function invitationEmailWindowStart
 *
 * @description
 * The instant the window of `now` starts: an email sent at it or before no longer counts.
 *
 * @param {Date} now - The instant of the request.
 * @returns {Date} `now` minus 24 hours.
 */
export function invitationEmailWindowStart(now: Date): Date {
  return new Date(now.getTime() - INVITATION_EMAIL_WINDOW_MS);
}

/**
 * Function assertInvitationEmailsAvailable
 *
 * @description
 * Refuses, as a whole, a request that needs more invitation emails than the organization has left:
 * a batch needs one per address that would be `invited`, a resend one. A request that needs none,
 * such as a batch of members and pending invitations only, is never refused. `nextAvailableAt` is
 * when the oldest email counted leaves the window, which is when the allowance grows again
 * (`openapi/internal/organization-service.yaml`, `POST /internal/v1/invitations`). With nothing
 * counted, only a need above the whole allowance is refused, which the 50 addresses of a batch rule
 * out; it would then wait one full window.
 *
 * @param {InvitationEmailUsage} usage - The emails counted in the window of `now`.
 * @param {number} needed - The emails the request would cause.
 * @param {Date} now - The instant of the request.
 * @throws {InvitationDailyLimitReachedError} When `needed` exceeds what remains.
 */
export function assertInvitationEmailsAvailable(
  usage: InvitationEmailUsage,
  needed: number,
  now: Date,
): void {
  const remaining: number = Math.max(0, DAILY_INVITATION_EMAILS - usage.count);
  if (needed <= remaining) {
    return;
  }
  const oldest: Date = usage.oldestSentAt ?? now;
  throw new InvitationDailyLimitReachedError(
    remaining,
    new Date(oldest.getTime() + INVITATION_EMAIL_WINDOW_MS),
  );
}
