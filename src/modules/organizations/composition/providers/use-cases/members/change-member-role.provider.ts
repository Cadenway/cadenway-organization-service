import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ChangeMemberRole } from '../../../../application/use-cases/commands/members/change-member-role/change-member-role.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant changeMemberRoleProvider
 *
 * @description
 * Builds the change of role of a member.
 *
 * @type {FactoryProvider<ChangeMemberRole>}
 */
export const changeMemberRoleProvider: FactoryProvider<ChangeMemberRole> = {
  provide: ChangeMemberRole,
  inject: [UNIT_OF_WORK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork): ChangeMemberRole =>
    new ChangeMemberRole(unitOfWork),
};
