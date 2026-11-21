import { ListBillingMembershipsInternalQueryParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/** Published query for the tenant Billing membership export. */
export class BillingMembershipsQuery extends zodDto(
  ListBillingMembershipsInternalQueryParams.strict(),
) {}
