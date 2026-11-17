import type { FactoryProvider } from '@nestjs/common';

import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { InviteMembers } from '../../../../application/use-cases/commands/invitations/invite-members/invite-members.use-case.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant inviteMembersProvider
 *
 * @description
 * Builds the invitation batch with its clock.
 *
 * @type {FactoryProvider<InviteMembers>}
 */
export const inviteMembersProvider: FactoryProvider<InviteMembers> = {
  provide: InviteMembers,
  inject: [UNIT_OF_WORK, CLOCK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork, clock: Clock): InviteMembers =>
    new InviteMembers(unitOfWork, clock),
};
