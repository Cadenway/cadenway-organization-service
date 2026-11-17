/**
 * Interface RemoveDeletedUserInput
 *
 * @description
 * What `user.deleted.v1` tells this service: the account identity-service deleted and its last
 * version.
 */
export interface RemoveDeletedUserInput {
  // #region Properties
  /**
   * Property userId
   *
   * @description
   * The deleted account.
   *
   * @type {string}
   * @readonly
   */
  readonly userId: string;

  /**
   * Property version
   *
   * @description
   * Version of the account after the deletion, its last.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;
  // #endregion
}
