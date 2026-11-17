/**
 * Interface ProjectEmailChangeInput
 *
 * @description
 * What `user.email-changed.v1` tells the user directory: the new address of the account, verified
 * by the code sent to it.
 */
export interface ProjectEmailChangeInput {
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
   * Property email
   *
   * @description
   * The new address, verified.
   *
   * @type {string}
   * @readonly
   */
  readonly email: string;
  // #endregion
}
