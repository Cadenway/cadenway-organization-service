import type { SeatEntitlement } from '../../../../../domain/value-objects/billing/seat-entitlement.value-object.js';

/** The tenant and projected values from a verified Billing snapshot. */
export interface ApplySeatEntitlementInput {
  // #region Properties
  /** Organization in the verified context that selects the tenant transaction. */
  readonly organizationId: string;

  /** Validated seat values for that organization. */
  readonly entitlement: SeatEntitlement;
  // #endregion
}
