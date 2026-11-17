import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { GetCurrentOrganization } from '../../../../application/use-cases/queries/organizations/get-current-organization/get-current-organization.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant getCurrentOrganizationProvider
 *
 * @description
 * Builds the reading of the organization of the request.
 *
 * @type {FactoryProvider<GetCurrentOrganization>}
 */
export const getCurrentOrganizationProvider: FactoryProvider<GetCurrentOrganization> = {
  provide: GetCurrentOrganization,
  inject: [UNIT_OF_WORK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork): GetCurrentOrganization =>
    new GetCurrentOrganization(unitOfWork),
};
