import type { FactoryProvider } from '@nestjs/common';
import type { VerifiedEmailAuthority } from '../../../../application/ports/outbound/identity/invitations/verified-email-authority.port.js';

import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { RefuseInvitation } from '../../../../application/use-cases/commands/invitations/refuse-invitation/refuse-invitation.use-case.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';
import { VERIFIED_EMAIL_AUTHORITY } from '../../adapters/invitations/verified-email-authority.provider.js';

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
  inject: [UNIT_OF_WORK, CLOCK, VERIFIED_EMAIL_AUTHORITY],
  useFactory: (
    unitOfWork: OrganizationsUnitOfWork,
    clock: Clock,
    verifiedEmails: VerifiedEmailAuthority,
  ): RefuseInvitation => new RefuseInvitation(unitOfWork, clock, verifiedEmails),
};
