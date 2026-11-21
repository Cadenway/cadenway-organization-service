import { ListBillingOrganizationsInternalQueryParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/** Published query for the global Billing organization export. */
export class BillingOrganizationsQuery extends zodDto(
  ListBillingOrganizationsInternalQueryParams.strict(),
) {}
