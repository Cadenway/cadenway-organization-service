import { ListMembersInternalQueryParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';
import { z } from 'zod';

import {
  integerParameter,
  listParameter,
} from '../../../validation/queries/query-parameter.validation.js';

/**
 * Class ListMembersQuery
 *
 * @description
 * Query of `GET /internal/v1/members`: `cursor`, `limit`, `search` and `role` of the contract,
 * `limit` read from the text of the query string and `role` from its comma-separated values
 * (`role=owner,admin`). An unknown parameter answers `400 request.invalid`.
 */
export class ListMembersQuery extends zodDto(
  z.object({
    ...ListMembersInternalQueryParams.shape,
    limit: integerParameter(ListMembersInternalQueryParams.shape.limit),
    role: listParameter(ListMembersInternalQueryParams.shape.role),
  }),
) {}
