import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ListMyOrganizations } from '../../../../application/use-cases/queries/organizations/list-my-organizations/list-my-organizations.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant listMyOrganizationsProvider
 *
 * @description
 * Builds the list of the organizations of the actor.
 *
 * @type {FactoryProvider<ListMyOrganizations>}
 */
export const listMyOrganizationsProvider: FactoryProvider<ListMyOrganizations> = {
  provide: ListMyOrganizations,
  inject: [UNIT_OF_WORK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork): ListMyOrganizations =>
    new ListMyOrganizations(unitOfWork),
};
