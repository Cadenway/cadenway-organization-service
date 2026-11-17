import { ListReceivedInvitationsInternalQueryParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';
import { z } from 'zod';

import { integerParameter } from '../../../validation/queries/query-parameter.validation.js';

/**
 * Class ListReceivedInvitationsQuery
 *
 * @description
 * Query of `GET /internal/v1/users/{userId}/invitations`: the `cursor` and `limit` of the contract,
 * `limit` read from the text of the query string.
 */
export class ListReceivedInvitationsQuery extends zodDto(
  z.object({
    ...ListReceivedInvitationsInternalQueryParams.shape,
    limit: integerParameter(ListReceivedInvitationsInternalQueryParams.shape.limit),
  }),
) {}
