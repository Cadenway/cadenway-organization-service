import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';

import { InvitationKeyedBatchLimitReachedError } from '../../errors/invitations/invitation-keyed-batch-limit-reached.error.js';
import type { KeyedInvitationBatchUsage } from '../../value-objects/invitations/keyed-invitation-batch-usage.value-object.js';
import { INVITATION_BATCH_LEASE_MS } from './invitation-batch-replay.policy.js';
import {
  assertKeyedInvitationBatchAvailable,
  KEYED_INVITATION_BATCH_BUDGET,
  KEYED_INVITATION_BATCH_RUNNING_DELAY_MS,
  keyedInvitationBatchStoredToRead,
} from './keyed-invitation-batch-budget.policy.js';

/** The instant of the read: 8 November 2026, 10:30 in Paris. */
const NOW: Date = new Date('2026-11-08T09:30:00Z');

/** One minute, in milliseconds. */
const MINUTE: number = 60_000;

/**
 * The expiry of a stored outcome of Atelier Nord, some minutes after the read.
 *
 * @param minutes - How many minutes after the read it expires.
 * @returns The expiry.
 */
function expiringIn(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * MINUTE);
}

/**
 * What the repository reads of a full usage: the running batches up to the budget and the
 * newest stored outcomes, as many as the places the running batches leave.
 *
 * @param budget - The budget.
 * @param running - Every running batch.
 * @param stored - The expiries of every stored outcome.
 * @returns The usage read up to the budget.
 */
function readUpTo(
  budget: number,
  running: number,
  stored: readonly Date[],
): KeyedInvitationBatchUsage {
  const counted: number = Math.min(running, budget);
  return {
    running: counted,
    newestStoredExpiries: [...stored]
      .sort((left: Date, right: Date) => right.getTime() - left.getTime())
      .slice(0, keyedInvitationBatchStoredToRead(budget, counted)),
    readAt: NOW,
  };
}

/**
 * The refusal of a new key, or `null` when it is admitted.
 *
 * @param budget - The budget.
 * @param usage - What the organization holds.
 * @returns The error thrown.
 */
function refusalOf(budget: number, usage: KeyedInvitationBatchUsage): unknown {
  try {
    assertKeyedInvitationBatchAvailable(budget, usage);
    return null;
  } catch (error) {
    return error;
  }
}

describe('replay record budget of keyed invitation batches', () => {
  it('holds 1,000 keyed batches per organization, ten times the 100 daily invitation emails', () => {
    expect(KEYED_INVITATION_BATCH_BUDGET).toBe(1_000);
    expect(KEYED_INVITATION_BATCH_RUNNING_DELAY_MS).toBe(INVITATION_BATCH_LEASE_MS);
  });

  it('admits a new key while stored outcomes and running batches leave a place', () => {
    expect(refusalOf(3, readUpTo(3, 0, []))).toBeNull();
    expect(refusalOf(3, readUpTo(3, 1, [expiringIn(10)]))).toBeNull();
    expect(refusalOf(3, readUpTo(3, 0, [expiringIn(10), expiringIn(20)]))).toBeNull();
    expect(refusalOf(3, readUpTo(3, 2, []))).toBeNull();
  });

  it('refuses the key that would take the organization past the budget, with the expiry that frees a place', () => {
    const refusal: unknown = refusalOf(
      3,
      readUpTo(3, 1, [expiringIn(30), expiringIn(10), expiringIn(20)]),
    );

    // Four counted for three places: two must expire, the second oldest frees the place.
    expect(refusal).toBeInstanceOf(InvitationKeyedBatchLimitReachedError);
    expect(refusal).toMatchObject({ nextAvailableAt: expiringIn(20) });
  });

  it('refuses at the budget exactly with the expiry of the oldest stored outcome', () => {
    expect(
      refusalOf(3, readUpTo(3, 0, [expiringIn(45), expiringIn(5), expiringIn(25)])),
    ).toMatchObject({ nextAvailableAt: expiringIn(5) });
    expect(refusalOf(3, readUpTo(3, 2, [expiringIn(45)]))).toMatchObject({
      nextAvailableAt: expiringIn(45),
    });
  });

  it('answers a lease away when running batches alone fill the budget, whatever is stored', () => {
    for (const usage of [readUpTo(3, 3, []), readUpTo(3, 5, [expiringIn(1), expiringIn(2)])]) {
      expect(refusalOf(3, usage)).toMatchObject({
        nextAvailableAt: new Date(NOW.getTime() + INVITATION_BATCH_LEASE_MS),
      });
    }
  });

  it('reads no more stored outcomes than the places the running batches leave', () => {
    expect(keyedInvitationBatchStoredToRead(1_000, 0)).toBe(1_000);
    expect(keyedInvitationBatchStoredToRead(1_000, 999)).toBe(1);
    expect(keyedInvitationBatchStoredToRead(1_000, 1_000)).toBe(0);
  });

  test.prop([
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 0, max: 15 }),
    fc.array(fc.integer({ min: 1, max: 24 * 60 }), { maxLength: 30 }),
  ])(
    'admits only below the budget, and otherwise answers the (count - budget + 1)-th oldest expiry',
    (budget: number, running: number, minutes: number[]) => {
      const stored: Date[] = minutes.map(expiringIn);
      const refusal: unknown = refusalOf(budget, readUpTo(budget, running, stored));
      const count: number = running + stored.length;

      if (count < budget) {
        expect(refusal).toBeNull();
        return;
      }
      expect(refusal).toBeInstanceOf(InvitationKeyedBatchLimitReachedError);
      const oldestFirst: Date[] = [...stored].sort(
        (left: Date, right: Date) => left.getTime() - right.getTime(),
      );
      const expected: Date =
        running >= budget
          ? new Date(NOW.getTime() + INVITATION_BATCH_LEASE_MS)
          : (oldestFirst[count - budget] ?? NOW);
      expect((refusal as InvitationKeyedBatchLimitReachedError).nextAvailableAt).toEqual(expected);
    },
  );
});
