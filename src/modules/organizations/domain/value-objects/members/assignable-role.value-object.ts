import type { Role } from './role.value-object.js';

/**
 * Type AssignableRole
 *
 * @description
 * A role that an invitation or a change of role gives: never `owner`, since nobody becomes owner by
 * a change of role (decision 1 of P2b).
 *
 * @type {Exclude<Role, 'owner'>}
 */
export type AssignableRole = Exclude<Role, 'owner'>;
