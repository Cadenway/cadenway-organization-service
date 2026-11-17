import { ListInvitationsInternalQueryParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';
import { z } from 'zod';

import { integerParameter } from '../../../validation/queries/query-parameter.validation.js';

/**
 * Class ListInvitationsQuery
 *
 * @description
 * Query of `GET /internal/v1/invitations`: the `cursor` and `limit` of the contract, `limit` read
 * from the text of the query string.
 */
export class ListInvitationsQuery extends zodDto(
  z.object({
    ...ListInvitationsInternalQueryParams.shape,
    limit: integerParameter(ListInvitationsInternalQueryParams.shape.limit),
  }),
) {}
