/** A page of eligible user IDs and its continuation position. */
export interface ListQuotaNotificationRecipientsOutput {
  // #region Properties
  /** Eligible user IDs in ascending UUID order. */
  readonly items: readonly string[];

  /** Last returned user ID when an additional eligible user exists. */
  readonly nextUserId: string | null;
  // #endregion
}
