/**
 * Interface InviterView
 *
 * @description
 * Who sent an invitation ("Invité par {nom}", `Inviter` of the contract).
 */
export interface InviterView {
  // #region Properties
  /**
   * Property userId
   *
   * @description
   * Account of the owner or the admin who invited.
   *
   * @type {string}
   * @readonly
   */
  readonly userId: string;

  /**
   * Property name
   *
   * @description
   * Full name, from the user directory.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;
  // #endregion
}
