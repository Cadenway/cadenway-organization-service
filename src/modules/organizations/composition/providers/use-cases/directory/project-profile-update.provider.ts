import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ProjectProfileUpdate } from '../../../../application/use-cases/commands/directory/project-profile-update/project-profile-update.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant projectProfileUpdateProvider
 *
 * @description
 * Builds the projection of `user.profile-updated.v1`.
 *
 * @type {FactoryProvider<ProjectProfileUpdate>}
 */
export const projectProfileUpdateProvider: FactoryProvider<ProjectProfileUpdate> = {
  provide: ProjectProfileUpdate,
  inject: [UNIT_OF_WORK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork): ProjectProfileUpdate =>
    new ProjectProfileUpdate(unitOfWork),
};
