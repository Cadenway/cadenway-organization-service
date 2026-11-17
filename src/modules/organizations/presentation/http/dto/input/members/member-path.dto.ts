import { GetMemberInternalParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/**
 * Class MemberPath
 *
 * @description
 * Path of `/internal/v1/members/{memberId}`: a UUID, else `400 request.invalid`. The three
 * operations of the path declare the same parameter.
 */
export class MemberPath extends zodDto(GetMemberInternalParams) {}
