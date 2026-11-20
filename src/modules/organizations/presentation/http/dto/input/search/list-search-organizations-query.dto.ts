import { ListSearchOrganizationsInternalQueryParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/** The published global export query, without tenant or actor overrides. */
export class ListSearchOrganizationsQuery extends zodDto(
  ListSearchOrganizationsInternalQueryParams.strict(),
) {}
