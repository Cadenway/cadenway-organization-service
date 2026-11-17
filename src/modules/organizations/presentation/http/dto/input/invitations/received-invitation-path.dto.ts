import { AcceptInvitationInternalParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/**
 * Class ReceivedInvitationPath
 *
 * @description
 * Path of `/internal/v1/users/{userId}/invitations/{invitationId}/accept` and `/refuse`: two
 * UUIDs, else `400 request.invalid`.
 */
export class ReceivedInvitationPath extends zodDto(AcceptInvitationInternalParams) {}
