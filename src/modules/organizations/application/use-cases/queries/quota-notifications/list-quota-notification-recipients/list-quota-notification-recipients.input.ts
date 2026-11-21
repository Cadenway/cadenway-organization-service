/** A verified tenant and a decoded recipient page position. */
export interface ListQuotaNotificationRecipientsInput {
  // #region Properties
  /** Organization from the verified event token. */
  readonly organizationId: string;

  /** Last user ID returned on the previous page, or null for the first page. */
  readonly afterUserId: string | null;

  /** Maximum number of recipients, from 1 to 100. */
  readonly limit: number;
  // #endregion
}
