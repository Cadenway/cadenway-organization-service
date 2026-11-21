import type { BillingMembershipPosition } from '../../../../models/billing/billing-membership-position.model.js';

/** The signed organization and the validated membership export page request. */
export interface ListBillingMembershipsInput {
  // #region Properties
  /** Organization taken from the verified internal token. */
  readonly organizationId: string;

  /** Authenticated scan position, or null for the first page. */
  readonly position: BillingMembershipPosition | null;

  /** Maximum number of membership observations to return. */
  readonly limit: number;
  // #endregion
}
