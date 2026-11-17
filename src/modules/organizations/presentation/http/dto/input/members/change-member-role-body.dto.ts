import { ChangeMemberRoleInternalBody } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/**
 * Class ChangeMemberRoleBody
 *
 * @description
 * Body of `PATCH /internal/v1/members/{memberId}` (`MemberPatch`): a role among `admin`, `member`
 * and `guest`; `owner` answers `400 request.invalid`.
 */
export class ChangeMemberRoleBody extends zodDto(ChangeMemberRoleInternalBody) {}
