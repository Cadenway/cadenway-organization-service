import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { UpdateOrganization } from '../../../../application/use-cases/commands/organizations/update-organization/update-organization.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant updateOrganizationProvider
 *
 * @description
 * Builds the change of the organization of the request.
 *
 * @type {FactoryProvider<UpdateOrganization>}
 */
export const updateOrganizationProvider: FactoryProvider<UpdateOrganization> = {
  provide: UpdateOrganization,
  inject: [UNIT_OF_WORK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork): UpdateOrganization =>
    new UpdateOrganization(unitOfWork),
};
