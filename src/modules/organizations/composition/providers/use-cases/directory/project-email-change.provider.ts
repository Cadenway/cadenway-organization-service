import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ProjectEmailChange } from '../../../../application/use-cases/commands/directory/project-email-change/project-email-change.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant projectEmailChangeProvider
 *
 * @description
 * Builds the projection of `user.email-changed.v1`.
 *
 * @type {FactoryProvider<ProjectEmailChange>}
 */
export const projectEmailChangeProvider: FactoryProvider<ProjectEmailChange> = {
  provide: ProjectEmailChange,
  inject: [UNIT_OF_WORK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork): ProjectEmailChange =>
    new ProjectEmailChange(unitOfWork),
};
