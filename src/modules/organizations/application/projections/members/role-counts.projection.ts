/**
 * Interface RoleCounts
 *
 * @description
 * Members of an organization by role, whatever the filters of the list: the counts of the role tabs
 * and of the summary ("{n} membres et {n} invités").
 */
export interface RoleCounts {
  // #region Properties
  /**
   * Property owner
   *
   * @description
   * Owners: 1.
   *
   * @type {number}
   * @readonly
   */
  readonly owner: number;

  /**
   * Property admin
   *
   * @description
   * Admins.
   *
   * @type {number}
   * @readonly
   */
  readonly admin: number;

  /**
   * Property member
   *
   * @description
   * Members.
   *
   * @type {number}
   * @readonly
   */
  readonly member: number;

  /**
   * Property guest
   *
   * @description
   * Guests.
   *
   * @type {number}
   * @readonly
   */
  readonly guest: number;
  // #endregion
}
