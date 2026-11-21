import type { BillingMembershipPosition } from '../../../../models/billing/billing-membership-position.model.js';
import type { BillingMembershipProjection } from '../../../../projections/billing/billing-membership.projection.js';

/** A membership export page and its authenticated continuation position. */
export interface ListBillingMembershipsOutput {
  // #region Properties
  /** Active and removed memberships in ascending identifier order. */
  readonly items: readonly BillingMembershipProjection[];

  /** Continuation position when another observation exists. */
  readonly nextPosition: BillingMembershipPosition | null;
  // #endregion
}
