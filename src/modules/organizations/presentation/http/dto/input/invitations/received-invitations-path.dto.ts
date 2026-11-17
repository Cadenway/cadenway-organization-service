import { ListReceivedInvitationsInternalParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/**
 * Class ReceivedInvitationsPath
 *
 * @description
 * Path of `/internal/v1/users/{userId}/invitations`: a UUID, else `400 request.invalid`.
 */
export class ReceivedInvitationsPath extends zodDto(ListReceivedInvitationsInternalParams) {}
