import type { Role } from '../../../domain/value-objects/members/role.value-object.js';

/**
 * Interface MemberFilters
 *
 * @description
 * The filters of the member list ("Rechercher un membre", the role tabs).
 */
export interface MemberFilters {
  // #region Properties
  /**
   * Property search
   *
   * @description
   * Search key to find in the name or the address (`searchKeyOf`), or `null` for every member.
   *
   * @type {string | null}
   * @readonly
   */
  readonly search: string | null;

  /**
   * Property roles
   *
   * @description
   * Roles to keep, or `null` for every role.
   *
   * @type {readonly Role[] | null}
   * @readonly
   */
  readonly roles: readonly Role[] | null;
  // #endregion
}
