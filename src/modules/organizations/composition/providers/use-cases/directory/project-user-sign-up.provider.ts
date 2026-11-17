import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ProjectUserSignUp } from '../../../../application/use-cases/commands/directory/project-user-sign-up/project-user-sign-up.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant projectUserSignUpProvider
 *
 * @description
 * Builds the projection of `user.signed-up.v1`.
 *
 * @type {FactoryProvider<ProjectUserSignUp>}
 */
export const projectUserSignUpProvider: FactoryProvider<ProjectUserSignUp> = {
  provide: ProjectUserSignUp,
  inject: [UNIT_OF_WORK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork): ProjectUserSignUp =>
    new ProjectUserSignUp(unitOfWork),
};
