import { ListMyOrganizationsInternalQueryParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';
import { z } from 'zod';

import { integerParameter } from '../../../validation/queries/query-parameter.validation.js';

/**
 * Class ListMyOrganizationsQuery
 *
 * @description
 * Query of `GET /internal/v1/organizations`: the `cursor` and `limit` of the contract, `limit` read
 * from the text of the query string. An unknown parameter answers `400 request.invalid`.
 */
export class ListMyOrganizationsQuery extends zodDto(
  z.object({
    ...ListMyOrganizationsInternalQueryParams.shape,
    limit: integerParameter(ListMyOrganizationsInternalQueryParams.shape.limit),
  }),
) {}
