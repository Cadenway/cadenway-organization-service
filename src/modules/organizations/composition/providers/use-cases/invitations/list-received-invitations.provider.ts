import type { FactoryProvider } from '@nestjs/common';
import type { VerifiedEmailAuthority } from '../../../../application/ports/outbound/identity/invitations/verified-email-authority.port.js';

import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ListReceivedInvitations } from '../../../../application/use-cases/queries/invitations/list-received-invitations/list-received-invitations.use-case.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';
import { VERIFIED_EMAIL_AUTHORITY } from '../../adapters/invitations/verified-email-authority.provider.js';

/**
 * Constant listReceivedInvitationsProvider
 *
 * @description
 * Builds the list of the invitations addressed to the actor with its clock.
 *
 * @type {FactoryProvider<ListReceivedInvitations>}
 */
export const listReceivedInvitationsProvider: FactoryProvider<ListReceivedInvitations> = {
  provide: ListReceivedInvitations,
  inject: [UNIT_OF_WORK, CLOCK, VERIFIED_EMAIL_AUTHORITY],
  useFactory: (
    unitOfWork: OrganizationsUnitOfWork,
    clock: Clock,
    verifiedEmails: VerifiedEmailAuthority,
  ): ListReceivedInvitations => new ListReceivedInvitations(unitOfWork, clock, verifiedEmails),
};
