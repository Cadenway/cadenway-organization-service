import { CONFIG } from '@cadenway/nest-common';
import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import type { Provider } from '@nestjs/common';

import type { AppConfig } from '../../../../../../config/app-config.js';
import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { GetBillingActiveSeatCount } from '../../../../application/use-cases/queries/billing/get-billing-active-seat-count/get-billing-active-seat-count.use-case.js';
import { ListBillingMemberships } from '../../../../application/use-cases/queries/billing/list-billing-memberships/list-billing-memberships.use-case.js';
import { ListQuotaNotificationRecipients } from '../../../../application/use-cases/queries/quota-notifications/list-quota-notification-recipients/list-quota-notification-recipients.use-case.js';
import { LookupQuotaNotificationRecipients } from '../../../../application/use-cases/queries/quota-notifications/lookup-quota-notification-recipients/lookup-quota-notification-recipients.use-case.js';
import { DrizzleBillingMembershipsReader } from '../../../../infrastructure/persistence/drizzle/repositories/billing/drizzle-billing-memberships.repository.js';
import { DrizzleQuotaNotificationRecipientsUnitOfWork } from '../../../../infrastructure/persistence/drizzle/transactions/quota-notifications/drizzle-quota-notification-recipients.unit-of-work.js';
import { BillingAuthorityCursor } from '../../../../presentation/http/mappers/billing/billing-authority-cursor.mapper.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/** Binds the Billing membership and quota notification authority queries. */
export const billingAuthorityProviders: readonly Provider[] = [
  {
    provide: BillingAuthorityCursor,
    inject: [CONFIG],
    useFactory: (config: AppConfig): BillingAuthorityCursor =>
      new BillingAuthorityCursor(config.BILLING_AUTHORITY_CURSOR_SECRET),
  },
  {
    provide: ListBillingMemberships,
    inject: [TenantTransactionRunner],
    useFactory: (tenant: TenantTransactionRunner): ListBillingMemberships =>
      new ListBillingMemberships(new DrizzleBillingMembershipsReader(tenant)),
  },
  {
    provide: GetBillingActiveSeatCount,
    inject: [UNIT_OF_WORK],
    useFactory: (unitOfWork: OrganizationsUnitOfWork): GetBillingActiveSeatCount =>
      new GetBillingActiveSeatCount(unitOfWork),
  },
  {
    provide: DrizzleQuotaNotificationRecipientsUnitOfWork,
    inject: [TenantTransactionRunner],
    useFactory: (tenant: TenantTransactionRunner): DrizzleQuotaNotificationRecipientsUnitOfWork =>
      new DrizzleQuotaNotificationRecipientsUnitOfWork(tenant),
  },
  {
    provide: ListQuotaNotificationRecipients,
    inject: [DrizzleQuotaNotificationRecipientsUnitOfWork],
    useFactory: (
      unitOfWork: DrizzleQuotaNotificationRecipientsUnitOfWork,
    ): ListQuotaNotificationRecipients => new ListQuotaNotificationRecipients(unitOfWork),
  },
  {
    provide: LookupQuotaNotificationRecipients,
    inject: [DrizzleQuotaNotificationRecipientsUnitOfWork],
    useFactory: (
      unitOfWork: DrizzleQuotaNotificationRecipientsUnitOfWork,
    ): LookupQuotaNotificationRecipients => new LookupQuotaNotificationRecipients(unitOfWork),
  },
];
