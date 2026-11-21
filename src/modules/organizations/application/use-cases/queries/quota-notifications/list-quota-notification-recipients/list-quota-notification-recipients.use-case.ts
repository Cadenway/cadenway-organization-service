import type { QuotaNotificationRecipientsUnitOfWork } from '../../../../ports/outbound/transactions/quota-notifications/quota-notification-recipients-unit-of-work.port.js';
import type { ListQuotaNotificationRecipientsInput } from './list-quota-notification-recipients.input.js';
import type { ListQuotaNotificationRecipientsOutput } from './list-quota-notification-recipients.output.js';

/** Lists currently eligible quota alert recipients for an organization. */
export class ListQuotaNotificationRecipients {
  // #region Constructor
  /** Binds the tenant snapshot used for both reads. */
  public constructor(private readonly unitOfWork: QuotaNotificationRecipientsUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Returns null for an absent organization and a continuation only when a lookahead exists. */
  public execute(
    input: ListQuotaNotificationRecipientsInput,
  ): Promise<ListQuotaNotificationRecipientsOutput | null> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      return Promise.reject(new RangeError('The quota notification page size must be 1 to 100.'));
    }

    return this.unitOfWork.read(input.organizationId, async (snapshot) => {
      if (!(await snapshot.organizationExists())) return null;
      const users = await snapshot.recipients.listActive(
        input.organizationId,
        input.afterUserId,
        input.limit + 1,
      );
      const items = users.slice(0, input.limit);
      const nextUserId = users.length > input.limit ? (items.at(-1) ?? null) : null;
      return { items, nextUserId };
    });
  }
  // #endregion
}
