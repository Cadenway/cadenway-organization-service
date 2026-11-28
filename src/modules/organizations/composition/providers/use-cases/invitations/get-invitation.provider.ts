import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { GetInvitation } from '../../../../application/use-cases/queries/invitations/get-invitation/get-invitation.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/**
 * Constant getInvitationProvider
 *
 * @description
 * Builds the read of one invitation, which reads the instant of its state from the store.
 *
 * @type {FactoryProvider<GetInvitation>}
 */
export const getInvitationProvider: FactoryProvider<GetInvitation> = {
  provide: GetInvitation,
  inject: [UNIT_OF_WORK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork): GetInvitation => new GetInvitation(unitOfWork),
};
