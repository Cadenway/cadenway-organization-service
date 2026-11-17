import type { FactoryProvider } from '@nestjs/common';

import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ListInvitations } from '../../../../application/use-cases/queries/invitations/list-invitations/list-invitations.use-case.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant listInvitationsProvider
 *
 * @description
 * Builds the list of the pending invitations with its clock.
 *
 * @type {FactoryProvider<ListInvitations>}
 */
export const listInvitationsProvider: FactoryProvider<ListInvitations> = {
  provide: ListInvitations,
  inject: [UNIT_OF_WORK, CLOCK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork, clock: Clock): ListInvitations =>
    new ListInvitations(unitOfWork, clock),
};
