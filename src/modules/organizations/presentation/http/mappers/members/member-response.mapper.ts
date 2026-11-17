import type { Member } from '@cadenway/contracts/types/internal/organization-service';

import type { MemberView } from '../../../../application/projections/members/member-view.projection.js';

/**
 * Function toMemberResponse
 *
 * @description
 * The `Member` of the contract. Its `version` gives the `ETag` of a single member.
 *
 * @param {MemberView} view - The member.
 * @returns {Member} The body.
 */
export function toMemberResponse(view: MemberView): Member {
  return {
    id: view.id,
    userId: view.userId,
    name: view.name,
    email: view.email,
    role: view.role,
    joinedAt: view.joinedAt.toISOString(),
    version: view.version,
  };
}
