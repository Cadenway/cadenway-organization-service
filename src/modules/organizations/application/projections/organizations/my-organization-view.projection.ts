import type { Role } from '../../../domain/value-objects/members/role.value-object.js';

/**
 * Interface MyOrganizationView
 *
 * @description
 * An organization of the reader as the picker lists it ("{rôle} · {n} membres · plan {plan}",
 * `MyOrganization` of the contract).
 */
export interface MyOrganizationView {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id of the organization.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property name
   *
   * @description
   * Name.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property slug
   *
   * @description
   * Address.
   *
   * @type {string}
   * @readonly
   */
  readonly slug: string;

  /**
   * Property role
   *
   * @description
   * Role of the reader in it.
   *
   * @type {Role}
   * @readonly
   */
  readonly role: Role;

  /**
   * Property memberCount
   *
   * @description
   * Members that take a seat.
   *
   * @type {number}
   * @readonly
   */
  readonly memberCount: number;

  /**
   * Property plan
   *
   * @description
   * Plan, `free` until billing exists.
   *
   * @type {string}
   * @readonly
   */
  readonly plan: string;

  /**
   * Property joinedAt
   *
   * @description
   * When the reader joined it.
   *
   * @type {Date}
   * @readonly
   */
  readonly joinedAt: Date;
  // #endregion
}
