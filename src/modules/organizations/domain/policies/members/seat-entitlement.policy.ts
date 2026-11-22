import { FREE_SEAT_ENTITLEMENT } from '../../value-objects/billing/seat-entitlement.value-object.js';
import type { SeatEntitlement } from '../../value-objects/billing/seat-entitlement.value-object.js';

const freeStorageByteLimit = 2_000_000_000;

/**
 * Classifies a verified `subscription.changed.v1` snapshot. A canonical Free snapshot may
 * lower the seat limit after Stripe cancellation, even if intervening versions were missed.
 * An equal version is a replay only if its projected fields match.
 *
 * @param current - The effective locked projection.
 * @param incoming - The verified Billing snapshot.
 * @param storageByteLimit - The storage limit from the same complete Billing snapshot.
 * @returns The admission projection decision.
 */
export function decideSeatEntitlement(
  current: SeatEntitlement,
  incoming: SeatEntitlement,
  storageByteLimit: number,
): 'advance' | 'unchanged' | 'refused' {
  const isFree = incoming.plan === FREE_SEAT_ENTITLEMENT.plan;
  if (
    !Number.isSafeInteger(incoming.version) ||
    !Number.isSafeInteger(incoming.seatLimit) ||
    incoming.version < current.version ||
    (isFree &&
      (incoming.seatLimit !== FREE_SEAT_ENTITLEMENT.seatLimit ||
        storageByteLimit !== freeStorageByteLimit)) ||
    (!isFree && incoming.seatLimit < current.seatLimit) ||
    incoming.plan.length === 0
  ) {
    return 'refused';
  }
  if (incoming.version === current.version) {
    return incoming.seatLimit === current.seatLimit && incoming.plan === current.plan
      ? 'unchanged'
      : 'refused';
  }
  return 'advance';
}
