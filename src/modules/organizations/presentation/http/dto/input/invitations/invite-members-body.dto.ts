import { InviteMembersInternalBody } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/**
 * Class InviteMembersBody
 *
 * @description
 * Body of `POST /internal/v1/invitations` (`InvitationBatch`): 1 to 50 addresses and one role,
 * `member` by default.
 */
export class InviteMembersBody extends zodDto(InviteMembersInternalBody) {}
