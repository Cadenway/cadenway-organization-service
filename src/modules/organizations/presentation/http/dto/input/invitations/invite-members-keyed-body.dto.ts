import { InviteMembersKeyedInternalBody } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/**
 * Class InviteMembersKeyedBody
 *
 * @description
 * The body of `POST /internal/v1/invitation-batches`: the addresses and the role, as the batch
 * without a key takes them.
 */
export class InviteMembersKeyedBody extends zodDto(InviteMembersKeyedInternalBody) {}
