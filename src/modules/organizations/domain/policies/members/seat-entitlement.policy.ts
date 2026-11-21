import type { SeatEntitlement } from '../../value-objects/billing/seat-entitlement.value-object.js';

/**
 * Classifies a Billing snapshot. This rollout applies only nondecreasing limits, even when
 * Billing changes the plan. An equal version is a replay only if its projected fields match.
 *
 * @param current - The effective locked projection.
 * @param incoming - The verified Billing snapshot.
 * @returns The admission projection decision.
 */
export function decideSeatEntitlement(
  current: SeatEntitlement,
  incoming: SeatEntitlement,
): 'advance' | 'unchanged' | 'refused' {
  if (
    !Number.isSafeInteger(incoming.version) ||
    !Number.isSafeInteger(incoming.seatLimit) ||
    incoming.version < current.version ||
    incoming.seatLimit < current.seatLimit ||
    incoming.plan.length === 0 ||
    Array.from(incoming.plan).length > 255
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
