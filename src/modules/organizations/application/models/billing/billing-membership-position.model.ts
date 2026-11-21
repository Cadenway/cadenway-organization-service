/** Stable upper and exclusive lower membership IDs for a resumed scan. */
export interface BillingMembershipPosition {
  // #region Properties
  /** Upper membership ID captured on the first page. */
  readonly upperId: string;

  /** Last ID returned on the preceding page. */
  readonly afterId: string;
  // #endregion
}
