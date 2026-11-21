import type { FactoryProvider } from '@nestjs/common';

import type { OrganizationsUnitOfWork } from '../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { ApplySeatEntitlement } from '../../../../application/use-cases/commands/billing/apply-seat-entitlement/apply-seat-entitlement.use-case.js';
import { UNIT_OF_WORK } from '../../../tokens/organizations/unit-of-work.token.js';

/** Binds the Billing seat projection to the Organization tenant transaction. */
export const applySeatEntitlementProvider: FactoryProvider<ApplySeatEntitlement> = {
  provide: ApplySeatEntitlement,
  inject: [UNIT_OF_WORK],
  useFactory: (unitOfWork: OrganizationsUnitOfWork): ApplySeatEntitlement =>
    new ApplySeatEntitlement(unitOfWork),
};
