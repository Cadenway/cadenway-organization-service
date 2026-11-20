import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import type { FactoryProvider } from '@nestjs/common';

import { LookupMemberNames } from '../../../../application/use-cases/queries/members/lookup-member-names/lookup-member-names.use-case.js';
import { DrizzleMemberNamesUnitOfWork } from '../../../../infrastructure/persistence/drizzle/transactions/organizations/drizzle-member-names.unit-of-work.js';

/** Binds the private member name lookup to a consistent tenant snapshot. */
export const lookupMemberNamesProvider: FactoryProvider<LookupMemberNames> = {
  provide: LookupMemberNames,
  inject: [TenantTransactionRunner],
  useFactory: (runner: TenantTransactionRunner): LookupMemberNames =>
    new LookupMemberNames(new DrizzleMemberNamesUnitOfWork(runner)),
};
