import { ListInvitationsInternalQueryParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/**
 * Class ListInvitationsQuery
 *
 * @description
 * Query of `GET /internal/v1/invitations`: the `cursor` and `limit` of the contract, whose
 * validator reads `limit` from the text of the query string. An unknown parameter answers
 * `400 request.invalid`.
 */
export class ListInvitationsQuery extends zodDto(ListInvitationsInternalQueryParams) {}
