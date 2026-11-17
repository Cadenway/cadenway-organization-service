import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ProjectEmailVerification } from '../../../../application/use-cases/commands/directory/project-email-verification/project-email-verification.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant projectEmailVerificationProvider
 *
 * @description
 * Builds the projection of `user.email-verified.v1`.
 *
 * @type {FactoryProvider<ProjectEmailVerification>}
 */
export const projectEmailVerificationProvider: FactoryProvider<ProjectEmailVerification> = {
  provide: ProjectEmailVerification,
  inject: [UNIT_OF_WORK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork): ProjectEmailVerification =>
    new ProjectEmailVerification(unitOfWork),
};
