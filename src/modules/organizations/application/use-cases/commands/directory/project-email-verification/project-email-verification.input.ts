/**
 * Interface ProjectEmailVerificationInput
 *
 * @description
 * What `user.email-verified.v1` tells the user directory.
 */
export interface ProjectEmailVerificationInput {
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
   * Version of the account after the verification.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;

  /**
   * Property email
   *
   * @description
   * The verified address.
   *
   * @type {string}
   * @readonly
   */
  readonly email: string;
  // #endregion
}
