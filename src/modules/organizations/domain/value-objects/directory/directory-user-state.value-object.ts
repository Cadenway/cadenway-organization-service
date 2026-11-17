/**
 * Interface DirectoryUserState
 *
 * @description
 * What this service knows of an account of identity-service, from `user.signed-up.v1`,
 * `user.email-verified.v1`, `user.profile-updated.v1`, `user.email-changed.v1` and
 * `user.deleted.v1` (decision 4 of P2b, `asyncapi/identity-service.yaml`). The events travel on
 * separate subjects and may arrive in any order, so each part keeps the version of the account
 * that last set it, and an older event never overwrites a newer one. A deleted account keeps its
 * entry as a former member, without name or address.
 */
export interface DirectoryUserState {
  // #region Properties
  /**
   * Property userId
   *
   * @description
   * Id of the account in identity-service.
   *
   * @type {string}
   * @readonly
   */
  readonly userId: string;

  /**
   * Property name
   *
   * @description
   * Full name, or `null` until an event that carries it is applied.
   *
   * @type {string | null}
   * @readonly
   */
  readonly name: string | null;

  /**
   * Property nameVersion
   *
   * @description
   * Version of the account that set the name; 0 before any.
   *
   * @type {number}
   * @readonly
   */
  readonly nameVersion: number;

  /**
   * Property email
   *
   * @description
   * Address of the account, trimmed and lowercased, or `null` until an event that carries it is
   * applied.
   *
   * @type {string | null}
   * @readonly
   */
  readonly email: string | null;

  /**
   * Property emailVerified
   *
   * @description
   * Whether a code proved the address (`user.email-verified.v1`).
   *
   * @type {boolean}
   * @readonly
   */
  readonly emailVerified: boolean;

  /**
   * Property emailVersion
   *
   * @description
   * Version of the account that set the address and its verification; 0 before any.
   *
   * @type {number}
   * @readonly
   */
  readonly emailVersion: number;

  /**
   * Property deleted
   *
   * @description
   * Whether identity-service deleted the account (`user.deleted.v1`): its name and address are
   * forgotten, and no later event of it applies.
   *
   * @type {boolean}
   * @readonly
   */
  readonly deleted: boolean;
  // #endregion
}
