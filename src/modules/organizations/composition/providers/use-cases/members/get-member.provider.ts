import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { GetMember } from '../../../../application/use-cases/queries/members/get-member/get-member.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant getMemberProvider
 *
 * @description
 * Builds the reading of a member.
 *
 * @type {FactoryProvider<GetMember>}
 */
export const getMemberProvider: FactoryProvider<GetMember> = {
  provide: GetMember,
  inject: [UNIT_OF_WORK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork): GetMember => new GetMember(unitOfWork),
};
