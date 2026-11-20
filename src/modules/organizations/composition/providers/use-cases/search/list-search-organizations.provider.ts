import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import type { FactoryProvider } from '@nestjs/common';

import { ListSearchOrganizations } from '../../../../application/use-cases/queries/search/list-search-organizations/list-search-organizations.use-case.js';
import { DrizzleSearchOrganizationsReader } from '../../../../infrastructure/persistence/drizzle/repositories/search/drizzle-search-organizations.repository.js';

/** Binds the global rebuild page to the read-only system reader. */
export const listSearchOrganizationsProvider: FactoryProvider<ListSearchOrganizations> = {
  provide: ListSearchOrganizations,
  inject: [SystemTransactionRunner],
  useFactory: (runner: SystemTransactionRunner): ListSearchOrganizations =>
    new ListSearchOrganizations(new DrizzleSearchOrganizationsReader(runner)),
};
