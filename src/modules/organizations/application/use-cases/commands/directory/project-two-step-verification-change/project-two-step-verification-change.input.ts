/**
 * Interface ProjectTwoStepVerificationChangeInput
 *
 * @description
 * What `user.two-step-verification-changed.v1` tells the user directory: whether the account has
 * two-step verification after the change, by its version. Nothing else of the event reaches the
 * directory: not the `change`, the methods, the backup codes or the security key, nor the device,
 * the IP address, the address, the name, the language or the time zone it carries for the email of
 * notification-service.
 */
export interface ProjectTwoStepVerificationChangeInput {
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
   * Property enabled
   *
   * @description
   * Whether two-step verification is on after the change.
   *
   * @type {boolean}
   * @readonly
   */
  readonly enabled: boolean;
  // #endregion
}
