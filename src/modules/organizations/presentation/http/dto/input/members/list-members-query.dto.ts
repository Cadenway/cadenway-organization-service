import { ListMembersInternalQueryParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';
import { z } from 'zod';

import { listParameter } from '../../../validation/queries/query-parameter.validation.js';

/**
 * Class ListMembersQuery
 *
 * @description
 * Query of `GET /internal/v1/members`: `cursor`, `limit`, `search` and `role` of the contract. Its
 * validator reads `limit` from the text of the query string; `role` is read from its
 * comma-separated values (`role=owner,admin`). An unknown parameter answers `400 request.invalid`.
 */
export class ListMembersQuery extends zodDto(
  z.object({
    ...ListMembersInternalQueryParams.shape,
    role: listParameter(ListMembersInternalQueryParams.shape.role),
  }),
) {}
