import type { Role } from '../../../domain/value-objects/members/role.value-object.js';

/**
 * Interface MemberView
 *
 * @description
 * A member as the member list shows it (`Member` of the contract): the membership and the name,
 * address and two-step verification of its account, from the user directory.
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

  /**
   * Property twoStepVerificationEnabled
   *
   * @description
   * Whether the account has two-step verification ("Deux étapes"), from the user directory, `false`
   * until an event says otherwise; `null` when the actor may not see it (anyone but the owner and
   * the admins), so that the answer leaves it out. The repositories read it; the use cases set it
   * to `null` with `toMemberViewFor` for such an actor.
   *
   * @type {boolean | null}
   * @readonly
   */
  readonly twoStepVerificationEnabled: boolean | null;
  // #endregion
}
