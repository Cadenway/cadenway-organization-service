/** The verified tenant and candidate user IDs to recheck. */
export interface LookupQuotaNotificationRecipientsInput {
  // #region Properties
  /** Organization from the verified event token. */
  readonly organizationId: string;

  /** One to one hundred user IDs to recheck. */
  readonly userIds: readonly string[];
  // #endregion
}
