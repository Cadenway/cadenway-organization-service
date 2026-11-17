import type { Role } from '../../value-objects/members/role.value-object.js';

/**
 * Constant SEAT_ROLES
 *
 * @description
 * The roles that take a seat and count in `memberCount`: owner, admins and members. Guests do not
 * ("Les invités ne consomment pas de siège.", "Plan Équipe · 18 membres" counts seat-holders).
 *
 * @type {readonly Role[]}
 */
export const SEAT_ROLES: readonly Role[] = ['owner', 'admin', 'member'];

/**
 * Function takesSeat
 *
 * @description
 * Whether a member of this role counts in `memberCount`.
 *
 * @param {Role} role - The role.
 * @returns {boolean} `false` for a guest only.
 */
export function takesSeat(role: Role): boolean {
  return SEAT_ROLES.includes(role);
}
