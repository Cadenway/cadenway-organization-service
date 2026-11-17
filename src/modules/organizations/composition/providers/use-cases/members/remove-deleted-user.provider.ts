import type { FactoryProvider } from '@nestjs/common';

import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { RemoveDeletedUser } from '../../../../application/use-cases/commands/members/remove-deleted-user/remove-deleted-user.use-case.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant removeDeletedUserProvider
 *
 * @description
 * Builds the removal of the memberships of a deleted account with its clock.
 *
 * @type {FactoryProvider<RemoveDeletedUser>}
 */
export const removeDeletedUserProvider: FactoryProvider<RemoveDeletedUser> = {
  provide: RemoveDeletedUser,
  inject: [UNIT_OF_WORK, CLOCK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork, clock: Clock): RemoveDeletedUser =>
    new RemoveDeletedUser(unitOfWork, clock),
};
