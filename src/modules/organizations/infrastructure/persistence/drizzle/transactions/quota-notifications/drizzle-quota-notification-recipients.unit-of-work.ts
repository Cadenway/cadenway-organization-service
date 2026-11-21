import type { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { eq } from 'drizzle-orm';

import type { QuotaNotificationRecipientsSnapshot } from '../../../../../application/models/quota-notifications/quota-notification-recipients-snapshot.model.js';
import type { QuotaNotificationRecipientsUnitOfWork } from '../../../../../application/ports/outbound/transactions/quota-notifications/quota-notification-recipients-unit-of-work.port.js';
import { DrizzleQuotaNotificationRecipientsReader } from '../../repositories/quota-notifications/drizzle-quota-notification-recipients.repository.js';
import { organizations } from '../../schemas/organizations/organization.schema.js';

/** Runs organization existence and recipient reads in one tenant snapshot. */
export class DrizzleQuotaNotificationRecipientsUnitOfWork implements QuotaNotificationRecipientsUnitOfWork {
  // #region Constructor
  /** Binds reads to the kit's tenant transaction runner. */
  public constructor(private readonly tenant: TenantTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Rejects a tenant mismatch before reading from the organization database. */
  public read<TResult>(
    organizationId: string,
    work: (snapshot: QuotaNotificationRecipientsSnapshot) => Promise<TResult>,
  ): Promise<TResult> {
    return this.tenant.run(
      (scope) => {
        if (scope.kind !== 'tenant' || scope.organizationId !== organizationId) {
          throw new Error('Quota notification organization does not match its tenant scope.');
        }
        return work({
          organizationExists: async () => {
            const rows = await scope.db
              .select({ id: organizations.id })
              .from(organizations)
              .where(eq(organizations.id, organizationId))
              .limit(1);
            return rows.length > 0;
          },
          recipients: new DrizzleQuotaNotificationRecipientsReader(scope.db),
        });
      },
      { isolationLevel: 'repeatable read', readOnly: true },
    );
  }
  // #endregion
}
