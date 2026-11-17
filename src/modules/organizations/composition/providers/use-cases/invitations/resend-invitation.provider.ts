import type { FactoryProvider } from '@nestjs/common';

import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ResendInvitation } from '../../../../application/use-cases/commands/invitations/resend-invitation/resend-invitation.use-case.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant resendInvitationProvider
 *
 * @description
 * Builds the resend of an invitation with its clock.
 *
 * @type {FactoryProvider<ResendInvitation>}
 */
export const resendInvitationProvider: FactoryProvider<ResendInvitation> = {
  provide: ResendInvitation,
  inject: [UNIT_OF_WORK, CLOCK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork, clock: Clock): ResendInvitation =>
    new ResendInvitation(unitOfWork, clock),
};
