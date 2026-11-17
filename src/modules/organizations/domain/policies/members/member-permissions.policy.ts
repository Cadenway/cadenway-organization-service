import { RoleForbiddenError } from '../../errors/members/role-forbidden.error.js';
import type { Role } from '../../value-objects/members/role.value-object.js';

/**
 * Constant MANAGING_ROLES
 *
 * @description
 * The roles that update the organization, invite, see the pending invitations, change roles and
 * remove members: the owner and the admins (decision 1 of P2b; "Administrateur — gère membres et
 * réglages").
 *
 * @type {readonly Role[]}
 */
const MANAGING_ROLES: readonly Role[] = ['owner', 'admin'];

/**
 * Constant MEMBER_LIST_ROLES
 *
 * @description
 * The roles that read the member list: everyone but the guests (decision 1 of P2b; "Invité — accès
 * à des listes précises").
 *
 * @type {readonly Role[]}
 */
const MEMBER_LIST_ROLES: readonly Role[] = ['owner', 'admin', 'member'];

/**
 * Function assertManagesOrganization
 *
 * @description
 * Refuses a role that may not update the organization, invite, see the pending invitations, change
 * roles or remove members. organization-service decides it from its own members, never from the
 * role the internal token carries.
 *
 * @param {Role} role - Role of the actor in the organization.
 * @throws {RoleForbiddenError} For a member or a guest.
 */
export function assertManagesOrganization(role: Role): void {
  if (!MANAGING_ROLES.includes(role)) {
    throw new RoleForbiddenError();
  }
}

/**
 * Function assertReadsMembers
 *
 * @description
 * Refuses a role that may not read the member list.
 *
 * @param {Role} role - Role of the actor in the organization.
 * @throws {RoleForbiddenError} For a guest.
 */
export function assertReadsMembers(role: Role): void {
  if (!MEMBER_LIST_ROLES.includes(role)) {
    throw new RoleForbiddenError();
  }
}
