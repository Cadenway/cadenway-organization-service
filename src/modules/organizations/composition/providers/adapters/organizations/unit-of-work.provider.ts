import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import { OutboxRelay, OutboxWriter } from '@cadenway/nest-messaging/outbox';
import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { DrizzleOrganizationsUnitOfWork } from '../../../../infrastructure/persistence/drizzle/transactions/organizations/drizzle-organizations.unit-of-work.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant unitOfWorkProvider
 *
 * @description
 * Binds the transactions of the organizations module to the runners and the outbox of the kit.
 *
 * @type {FactoryProvider<OrganizationsUnitOfWork>}
 */
export const unitOfWorkProvider: FactoryProvider<OrganizationsUnitOfWork> = {
  provide: UNIT_OF_WORK,
  inject: [TenantTransactionRunner, SystemTransactionRunner, OutboxWriter, OutboxRelay],
  useFactory: (
    tenant: TenantTransactionRunner,
    system: SystemTransactionRunner,
    outbox: OutboxWriter,
    relay: OutboxRelay,
  ): OrganizationsUnitOfWork => new DrizzleOrganizationsUnitOfWork(tenant, system, outbox, relay),
};
