/**
 * Interface ProjectProfileUpdateInput
 *
 * @description
 * What `user.profile-updated.v1` tells the user directory: the full name, the one member of the
 * profile this service shows.
 */
export interface ProjectProfileUpdateInput {
  // #region Properties
  /**
   * Property userId
   *
   * @description
   * The account.
   *
   * @type {string}
   * @readonly
   */
  readonly userId: string;

  /**
   * Property version
   *
   * @description
   * Version of the account after the change.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;

  /**
   * Property name
   *
   * @description
   * The full name after the change.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;
  // #endregion
}
