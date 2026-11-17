import { RevokeInvitationInternalParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/**
 * Class InvitationPath
 *
 * @description
 * Path of `/internal/v1/invitations/{invitationId}` and of its `/resend`: a UUID, else
 * `400 request.invalid`.
 */
export class InvitationPath extends zodDto(RevokeInvitationInternalParams) {}
