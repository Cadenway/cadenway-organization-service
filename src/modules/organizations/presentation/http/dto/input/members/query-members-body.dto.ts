import { QueryListMembersInternalBody } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/** JSON filters and pagination for `QUERY /internal/v1/members`. */
export class QueryMembersBody extends zodDto(QueryListMembersInternalBody) {}
