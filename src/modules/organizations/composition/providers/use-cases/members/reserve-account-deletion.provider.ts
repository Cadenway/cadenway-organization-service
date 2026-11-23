import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ReserveAccountDeletion } from '../../../../application/use-cases/commands/members/reserve-account-deletion/reserve-account-deletion.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/** Builds the account deletion reservation on the Organization system transaction. */
export const reserveAccountDeletionProvider: FactoryProvider<ReserveAccountDeletion> = {
  provide: ReserveAccountDeletion,
  inject: [UNIT_OF_WORK],
  useFactory: (work: OrganizationsUnitOfWork): ReserveAccountDeletion =>
    new ReserveAccountDeletion(work),
};
