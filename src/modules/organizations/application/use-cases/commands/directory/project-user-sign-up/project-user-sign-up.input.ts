/**
 * Interface ProjectUserSignUpInput
 *
 * @description
 * What `user.signed-up.v1` tells the user directory.
 */
export interface ProjectUserSignUpInput {
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
   * Version of the account after the sign-up.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;

  /**
   * Property email
   *
   * @description
   * The address signed up, not verified yet.
   *
   * @type {string}
   * @readonly
   */
  readonly email: string;

  /**
   * Property name
   *
   * @description
   * The full name typed at the sign-up.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;
  // #endregion
}
