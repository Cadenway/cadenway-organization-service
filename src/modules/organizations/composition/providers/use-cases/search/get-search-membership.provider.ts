import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import type { FactoryProvider } from '@nestjs/common';

import { GetSearchMembership } from '../../../../application/use-cases/queries/search/get-search-membership/get-search-membership.use-case.js';
import { DrizzleSearchMembershipReader } from '../../../../infrastructure/persistence/drizzle/repositories/search/drizzle-search-membership.repository.js';

/** Binds member stamps to a tenant snapshot. */
export const getSearchMembershipProvider: FactoryProvider<GetSearchMembership> = {
  provide: GetSearchMembership,
  inject: [TenantTransactionRunner],
  useFactory: (runner: TenantTransactionRunner): GetSearchMembership =>
    new GetSearchMembership(new DrizzleSearchMembershipReader(runner)),
};
