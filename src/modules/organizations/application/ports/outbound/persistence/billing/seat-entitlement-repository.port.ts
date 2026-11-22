import type { SeatEntitlement } from '../../../../../domain/value-objects/billing/seat-entitlement.value-object.js';

/** The tenant's Billing seat projection, bound to the caller's transaction. */
export interface SeatEntitlementRepository {
  // #region Methods
  /** Reads the committed projection, or null for a tenant on the legacy baseline. */
  find(organizationId: string): Promise<SeatEntitlement | null>;

  /** Applies a validated snapshot if the version read under the admission lock still matches. */
  writeNext(
    organizationId: string,
    expectedVersion: number,
    entitlement: SeatEntitlement,
  ): Promise<boolean>;
  // #endregion
}
