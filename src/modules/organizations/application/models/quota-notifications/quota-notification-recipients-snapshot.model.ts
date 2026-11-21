import type { QuotaNotificationRecipientsReader } from '../../ports/outbound/queries/quota-notifications/quota-notification-recipients-reader.port.js';

/** Organization existence and eligible recipient reads in one tenant snapshot. */
export interface QuotaNotificationRecipientsSnapshot {
  // #region Properties
  /** Checks whether the signed organization exists in this snapshot. */
  readonly organizationExists: () => Promise<boolean>;

  /** Reads eligible users from the same snapshot. */
  readonly recipients: QuotaNotificationRecipientsReader;
  // #endregion
}
