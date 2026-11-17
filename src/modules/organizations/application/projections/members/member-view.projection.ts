import type { Role } from '../../../domain/value-objects/members/role.value-object.js';

/**
 * Interface MemberView
 *
 * @description
 * A member as the member list shows it (`Member` of the contract): the membership and the name and
 * address of its account, from the user directory.
 */
export interface MemberView {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id of the membership.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property userId
   *
   * @description
   * Id of the account.
   *
   * @type {string}
   * @readonly
   */
  readonly userId: string;

  /**
   * Property name
   *
   * @description
   * Full name.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property email
   *
   * @description
   * Address.
   *
   * @type {string}
   * @readonly
   */
  readonly email: string;

  /**
   * Property role
   *
   * @description
   * Role.
   *
   * @type {Role}
   * @readonly
   */
  readonly role: Role;

  /**
   * Property joinedAt
   *
   * @description
   * When the membership began.
   *
   * @type {Date}
   * @readonly
   */
  readonly joinedAt: Date;

  /**
   * Property version
   *
   * @description
   * Version of the membership, its `ETag`.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;
  // #endregion
}
