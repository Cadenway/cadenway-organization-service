import { FREE_SEAT_ENTITLEMENT } from '../../../domain/value-objects/billing/seat-entitlement.value-object.js';
import type { SeatEntitlement } from '../../../domain/value-objects/billing/seat-entitlement.value-object.js';
import { OrganizationRefusal } from '../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../models/transactions/organizations-store.model.js';

/**
 * Resolves the committed limit or the legacy Free baseline.
 *
 * @param store - The caller's tenant transaction store.
 * @param organizationId - The tenant whose admission lock is held.
 * @returns The effective Billing seat projection.
 */
export async function readSeatEntitlement(
  store: OrganizationsStore,
  organizationId: string,
): Promise<SeatEntitlement> {
  return (await store.seatEntitlements.find(organizationId)) ?? FREE_SEAT_ENTITLEMENT;
}

/**
 * Ensures a seat remains for the new billed membership.
 *
 * @param store - The caller's tenant transaction store.
 * @param organizationId - The tenant whose admission lock is held.
 * @returns Resolves when a seat remains.
 * @throws {OrganizationRefusal} When the effective limit is exhausted.
 */
export async function requireAvailableSeat(
  store: OrganizationsStore,
  organizationId: string,
): Promise<void> {
  const { seatLimit } = await readSeatEntitlement(store, organizationId);
  if ((await store.members.countSeats(organizationId)) >= seatLimit) {
    throw new OrganizationRefusal({ reason: 'seat-quota-exceeded' });
  }
}
