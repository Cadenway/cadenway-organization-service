import { GetInvitationInternalParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/**
 * Class GetInvitationPath
 *
 * @description
 * The path of `GET /internal/v1/invitations/{invitationId}`: the id of the invitation, a UUID.
 */
export class GetInvitationPath extends zodDto(GetInvitationInternalParams) {}
