import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { OutboxRelay, OutboxWriter } from '@cadenway/nest-messaging/outbox';
import type { Provider } from '@nestjs/common';

import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import type { OrganizationLogoUnitOfWork } from '../../../../application/ports/outbound/transactions/logo/organization-logo-unit-of-work.port.js';
import { AbandonOrganizationLogoUpload } from '../../../../application/use-cases/commands/logo/abandon-organization-logo-upload/abandon-organization-logo-upload.use-case.js';
import { PublishOrganizationLogo } from '../../../../application/use-cases/commands/logo/publish-organization-logo/publish-organization-logo.use-case.js';
import { RemoveOrganizationLogo } from '../../../../application/use-cases/commands/logo/remove-organization-logo/remove-organization-logo.use-case.js';
import { ReserveOrganizationLogoUpload } from '../../../../application/use-cases/commands/logo/reserve-organization-logo-upload/reserve-organization-logo-upload.use-case.js';
import { GetOrganizationLogoUpload } from '../../../../application/use-cases/queries/logo/get-organization-logo-upload/get-organization-logo-upload.use-case.js';
import { DrizzleOrganizationLogoUnitOfWork } from '../../../../infrastructure/persistence/drizzle/transactions/logo/drizzle-organization-logo.unit-of-work.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';

const OWNER_RESERVATION_MS = 5 * 60 * 1_000;

/** Binds the logo owner operations to the clock and tenant transaction. */
export const organizationLogoProviders: readonly Provider[] = [
  {
    provide: DrizzleOrganizationLogoUnitOfWork,
    inject: [TenantTransactionRunner, OutboxWriter, OutboxRelay],
    useFactory: (
      tenant: TenantTransactionRunner,
      outbox: OutboxWriter,
      relay: OutboxRelay,
    ): OrganizationLogoUnitOfWork => new DrizzleOrganizationLogoUnitOfWork(tenant, outbox, relay),
  },
  {
    provide: ReserveOrganizationLogoUpload,
    inject: [DrizzleOrganizationLogoUnitOfWork, CLOCK],
    useFactory: (work: OrganizationLogoUnitOfWork, clock: Clock): ReserveOrganizationLogoUpload =>
      new ReserveOrganizationLogoUpload(work, clock, OWNER_RESERVATION_MS),
  },
  {
    provide: GetOrganizationLogoUpload,
    inject: [DrizzleOrganizationLogoUnitOfWork, CLOCK],
    useFactory: (work: OrganizationLogoUnitOfWork, clock: Clock): GetOrganizationLogoUpload =>
      new GetOrganizationLogoUpload(work, clock),
  },
  {
    provide: PublishOrganizationLogo,
    inject: [DrizzleOrganizationLogoUnitOfWork, CLOCK],
    useFactory: (work: OrganizationLogoUnitOfWork, clock: Clock): PublishOrganizationLogo =>
      new PublishOrganizationLogo(work, clock),
  },
  {
    provide: RemoveOrganizationLogo,
    inject: [DrizzleOrganizationLogoUnitOfWork],
    useFactory: (work: OrganizationLogoUnitOfWork): RemoveOrganizationLogo =>
      new RemoveOrganizationLogo(work),
  },
  {
    provide: AbandonOrganizationLogoUpload,
    inject: [DrizzleOrganizationLogoUnitOfWork, CLOCK],
    useFactory: (work: OrganizationLogoUnitOfWork, clock: Clock): AbandonOrganizationLogoUpload =>
      new AbandonOrganizationLogoUpload(work, clock),
  },
];
