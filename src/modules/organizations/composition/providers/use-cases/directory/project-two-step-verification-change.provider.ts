import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ProjectTwoStepVerificationChange } from '../../../../application/use-cases/commands/directory/project-two-step-verification-change/project-two-step-verification-change.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant projectTwoStepVerificationChangeProvider
 *
 * @description
 * Builds the projection of `user.two-step-verification-changed.v1`.
 *
 * @type {FactoryProvider<ProjectTwoStepVerificationChange>}
 */
export const projectTwoStepVerificationChangeProvider: FactoryProvider<ProjectTwoStepVerificationChange> =
  {
    provide: ProjectTwoStepVerificationChange,
    inject: [UNIT_OF_WORK],
    useFactory: (unitOfWork: OrganizationsUnitOfWork): ProjectTwoStepVerificationChange =>
      new ProjectTwoStepVerificationChange(unitOfWork),
  };
