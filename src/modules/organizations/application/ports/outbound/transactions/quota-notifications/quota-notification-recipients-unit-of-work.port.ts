import type { QuotaNotificationRecipientsSnapshot } from '../../../../models/quota-notifications/quota-notification-recipients-snapshot.model.js';

/** Opens one read-only, repeatable-read tenant snapshot for quota notification queries. */
export interface QuotaNotificationRecipientsUnitOfWork {
  // #region Methods
  /** Executes the organization existence check and recipient reads in the same snapshot. */
  read<TResult>(
    organizationId: string,
    work: (snapshot: QuotaNotificationRecipientsSnapshot) => Promise<TResult>,
  ): Promise<TResult>;
  // #endregion
}
