import type { FactoryProvider } from '@nestjs/common';

import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { RevokeInvitation } from '../../../../application/use-cases/commands/invitations/revoke-invitation/revoke-invitation.use-case.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant revokeInvitationProvider
 *
 * @description
 * Builds the revocation of an invitation with its clock.
 *
 * @type {FactoryProvider<RevokeInvitation>}
 */
export const revokeInvitationProvider: FactoryProvider<RevokeInvitation> = {
  provide: RevokeInvitation,
  inject: [UNIT_OF_WORK, CLOCK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork, clock: Clock): RevokeInvitation =>
    new RevokeInvitation(unitOfWork, clock),
};
