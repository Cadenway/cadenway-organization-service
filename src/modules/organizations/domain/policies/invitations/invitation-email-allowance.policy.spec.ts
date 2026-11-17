import { describe, expect, it } from 'vitest';

import { InvitationDailyLimitReachedError } from '../../errors/invitations/invitation-daily-limit-reached.error.js';
import type { InvitationEmailUsage } from '../../value-objects/invitations/invitation-email-usage.value-object.js';
import {
  assertInvitationEmailsAvailable,
  DAILY_INVITATION_EMAILS,
  invitationEmailWindowStart,
} from './invitation-email-allowance.policy.js';

/** The instant of the requests: 8 November 2026, 10:30 in Paris. */
const NOW: Date = new Date('2026-11-08T09:30:00Z');

/** When the oldest email counted went out, the day before. */
const OLDEST: Date = new Date('2026-11-07T11:00:00Z');

/**
 * The emails Atelier Nord caused in the window, the oldest on 7 November.
 *
 * @param count - How many.
 * @returns The usage.
 */
function used(count: number): InvitationEmailUsage {
  return { count, oldestSentAt: count === 0 ? null : OLDEST };
}

/**
 * The refusal of a request, or `null` when it passes.
 *
 * @param usage - The emails counted.
 * @param needed - The emails the request needs.
 * @returns The error thrown.
 */
function refusalOf(usage: InvitationEmailUsage, needed: number): unknown {
  try {
    assertInvitationEmailsAvailable(usage, needed, NOW);
    return null;
  } catch (error) {
    return error;
  }
}

describe('invitation email allowance', () => {
  it('counts the emails of the 24 hours before the request, a rolling window', () => {
    expect(DAILY_INVITATION_EMAILS).toBe(100);
    expect(invitationEmailWindowStart(NOW)).toEqual(new Date('2026-11-07T09:30:00Z'));
  });

  it('lets a request through while it needs no more than what remains, up to the 100th email', () => {
    expect(refusalOf(used(0), 50)).toBeNull();
    expect(refusalOf(used(50), 50)).toBeNull();
    expect(refusalOf(used(99), 1)).toBeNull();
  });

  it('refuses the 101st email with nothing remaining and the time the oldest one leaves the window', () => {
    const refusal: unknown = refusalOf(used(100), 1);

    expect(refusal).toBeInstanceOf(InvitationDailyLimitReachedError);
    expect(refusal).toMatchObject({
      remaining: 0,
      nextAvailableAt: new Date('2026-11-08T11:00:00Z'),
    });
  });

  it('refuses a batch that needs more than what remains as a whole, saying what remains', () => {
    expect(refusalOf(used(95), 6)).toMatchObject({ remaining: 5 });
    expect(refusalOf(used(95), 5)).toBeNull();
  });

  it('never refuses a request that needs no email, even with nothing left', () => {
    expect(refusalOf(used(100), 0)).toBeNull();
    expect(refusalOf(used(130), 0)).toBeNull();
  });

  it('answers 0 remaining, never a negative count, past the allowance', () => {
    expect(refusalOf(used(130), 1)).toMatchObject({ remaining: 0 });
  });
});
