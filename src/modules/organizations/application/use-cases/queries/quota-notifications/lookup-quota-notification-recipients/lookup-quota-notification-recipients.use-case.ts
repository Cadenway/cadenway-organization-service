import type { QuotaNotificationRecipientsUnitOfWork } from '../../../../ports/outbound/transactions/quota-notifications/quota-notification-recipients-unit-of-work.port.js';
import type { LookupQuotaNotificationRecipientsInput } from './lookup-quota-notification-recipients.input.js';
import type { LookupQuotaNotificationRecipientsOutput } from './lookup-quota-notification-recipients.output.js';

/** Rechecks quota alert recipients immediately before a delivery attempt. */
export class LookupQuotaNotificationRecipients {
  // #region Constructor
  /** Binds the tenant snapshot used for the organization and role checks. */
  public constructor(private readonly unitOfWork: QuotaNotificationRecipientsUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Returns null for an absent organization and the currently eligible requested users otherwise. */
  public execute(
    input: LookupQuotaNotificationRecipientsInput,
  ): Promise<LookupQuotaNotificationRecipientsOutput | null> {
    if (input.userIds.length < 1 || input.userIds.length > 100) {
      return Promise.reject(
        new RangeError('The quota notification lookup must contain 1 to 100 IDs.'),
      );
    }

    return this.unitOfWork.read(input.organizationId, async (snapshot) => {
      if (!(await snapshot.organizationExists())) return null;
      const userIds = [...new Set(input.userIds.map((userId) => userId.toLowerCase()))];
      return { items: await snapshot.recipients.findActive(input.organizationId, userIds) };
    });
  }
  // #endregion
}
