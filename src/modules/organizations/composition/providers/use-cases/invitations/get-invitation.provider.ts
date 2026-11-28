import type { FactoryProvider } from '@nestjs/common';

import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { GetInvitation } from '../../../../application/use-cases/queries/invitations/get-invitation/get-invitation.use-case.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant getInvitationProvider
 *
 * @description
 * Builds the read of one invitation with its clock.
 *
 * @type {FactoryProvider<GetInvitation>}
 */
export const getInvitationProvider: FactoryProvider<GetInvitation> = {
  provide: GetInvitation,
  inject: [UNIT_OF_WORK, CLOCK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork, clock: Clock): GetInvitation =>
    new GetInvitation(unitOfWork, clock),
};
