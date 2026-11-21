import type { BillingMembershipPosition } from '../../../../models/billing/billing-membership-position.model.js';
import type { BillingMembershipProjection } from '../../../../projections/billing/billing-membership.projection.js';

/** Reads a tenant's current and removed membership states in ascending membership ID order. */
export interface BillingMembershipsReader {
  // #region Methods
  /** Reads a keyset page, or returns null when the organization no longer exists. */
  read(
    organizationId: string,
    position: BillingMembershipPosition | null,
    maximum: number,
  ): Promise<{
    readonly upperId: string | null;
    readonly items: readonly BillingMembershipProjection[];
  } | null>;
  // #endregion
}
