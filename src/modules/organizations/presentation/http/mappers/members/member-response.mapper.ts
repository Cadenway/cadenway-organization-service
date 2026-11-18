import type { Member } from '@cadenway/contracts/types/internal/organization-service';

import type { MemberView } from '../../../../application/projections/members/member-view.projection.js';

/**
 * Function toMemberResponse
 *
 * @description
 * The `Member` of the contract. Its `version` gives the `ETag` of a single member.
 * `twoStepVerificationEnabled` is present when the use case kept it for the actor (the owner and
 * the admins) and absent otherwise, as the contract says.
 *
 * @param {MemberView} view - The member, as the actor may read it.
 * @returns {Member} The body.
 */
export function toMemberResponse(view: MemberView): Member {
  const member: Member = {
    id: view.id,
    userId: view.userId,
    name: view.name,
    email: view.email,
    role: view.role,
    joinedAt: view.joinedAt.toISOString(),
    version: view.version,
  };
  return view.twoStepVerificationEnabled === null
    ? member
    : { ...member, twoStepVerificationEnabled: view.twoStepVerificationEnabled };
}
