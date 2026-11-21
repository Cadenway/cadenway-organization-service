import type { SeatEntitlement } from '../../../../../domain/value-objects/billing/seat-entitlement.value-object.js';

/** The tenant's Billing seat projection, bound to the caller's transaction. */
export interface SeatEntitlementRepository {
  // #region Methods
  /** Reads the committed projection, or null for a tenant on the legacy baseline. */
  find(organizationId: string): Promise<SeatEntitlement | null>;

  /** Applies a newer nondecreasing limit by compare-and-set, with the admission lock held. */
  writeNext(organizationId: string, entitlement: SeatEntitlement): Promise<boolean>;
  // #endregion
}
