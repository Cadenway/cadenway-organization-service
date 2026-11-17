import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ListMembers } from '../../../../application/use-cases/queries/members/list-members/list-members.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant listMembersProvider
 *
 * @description
 * Builds the member list of the organization of the request.
 *
 * @type {FactoryProvider<ListMembers>}
 */
export const listMembersProvider: FactoryProvider<ListMembers> = {
  provide: ListMembers,
  inject: [UNIT_OF_WORK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork): ListMembers => new ListMembers(unitOfWork),
};
