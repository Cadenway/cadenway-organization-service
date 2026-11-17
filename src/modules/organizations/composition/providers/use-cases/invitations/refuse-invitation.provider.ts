import type { FactoryProvider } from '@nestjs/common';

import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { RefuseInvitation } from '../../../../application/use-cases/commands/invitations/refuse-invitation/refuse-invitation.use-case.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant refuseInvitationProvider
 *
 * @description
 * Builds the refusal of an invitation with its clock.
 *
 * @type {FactoryProvider<RefuseInvitation>}
 */
export const refuseInvitationProvider: FactoryProvider<RefuseInvitation> = {
  provide: RefuseInvitation,
  inject: [UNIT_OF_WORK, CLOCK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork, clock: Clock): RefuseInvitation =>
    new RefuseInvitation(unitOfWork, clock),
};
