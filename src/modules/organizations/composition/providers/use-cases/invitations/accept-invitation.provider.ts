import { CONFIG } from '@cadenway/nest-common';
import type { FactoryProvider } from '@nestjs/common';

import type { AppConfig } from '../../../../../../config/app-config.js';
import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { AcceptInvitation } from '../../../../application/use-cases/commands/invitations/accept-invitation/accept-invitation.use-case.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant acceptInvitationProvider
 *
 * @description
 * Builds the acceptance of an invitation with its clock.
 *
 * @type {FactoryProvider<AcceptInvitation>}
 */
export const acceptInvitationProvider: FactoryProvider<AcceptInvitation> = {
  provide: AcceptInvitation,
  inject: [UNIT_OF_WORK, CLOCK, CONFIG],
  useFactory: (
    unitOfWork: OrganizationsUnitOfWork,
    clock: Clock,
    config: AppConfig,
  ): AcceptInvitation =>
    new AcceptInvitation(unitOfWork, clock, config.ORGANIZATION_SEAT_QUOTA_ENABLED),
};
