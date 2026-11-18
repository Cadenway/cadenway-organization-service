import { seesTwoStepVerification } from '../../../domain/policies/members/member-permissions.policy.js';
import type { Role } from '../../../domain/value-objects/members/role.value-object.js';
import type { MemberView } from '../../projections/members/member-view.projection.js';

/**
 * Function toMemberViewFor
 *
 * @description
 * A member as an actor of the organization may read it: whether its account has two-step
 * verification stays for the owner and the admins and becomes `null`, left out of the answer, for
 * anyone else (`seesTwoStepVerification`). Every use case that returns members passes them through
 * it.
 *
 * @param {MemberView} member - The member, as the repository read it.
 * @param {Role} actorRole - Role of the actor in the organization.
 * @returns {MemberView} The member the actor may read.
 */
export function toMemberViewFor(member: MemberView, actorRole: Role): MemberView {
  if (seesTwoStepVerification(actorRole)) {
    return member;
  }
  return { ...member, twoStepVerificationEnabled: null };
}
