import type { FactoryProvider } from '@nestjs/common';

import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { RemoveMember } from '../../../../application/use-cases/commands/members/remove-member/remove-member.use-case.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant removeMemberProvider
 *
 * @description
 * Builds the removal of a member with its clock.
 *
 * @type {FactoryProvider<RemoveMember>}
 */
export const removeMemberProvider: FactoryProvider<RemoveMember> = {
  provide: RemoveMember,
  inject: [UNIT_OF_WORK, CLOCK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork, clock: Clock): RemoveMember =>
    new RemoveMember(unitOfWork, clock),
};
