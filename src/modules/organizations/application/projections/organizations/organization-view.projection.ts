import type { Role } from '../../../domain/value-objects/members/role.value-object.js';

/**
 * Interface OrganizationView
 *
 * @description
 * An organization as its member reads it (`Organization` of the contract): its profile, its plan,
 * its seat count and the role of the reader in it.
 */
export interface OrganizationView {
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
   * Property description
   *
   * @description
   * Description, or `null`.
   *
   * @type {string | null}
   * @readonly
   */
  readonly description: string | null;

  /**
   * Property website
   *
   * @description
   * Website, or `null`.
   *
   * @type {string | null}
   * @readonly
   */
  readonly website: string | null;

  /**
   * Property defaultLanguage
   *
   * @description
   * Default language.
   *
   * @type {string}
   * @readonly
   */
  readonly defaultLanguage: string;

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
   * Property memberCount
   *
   * @description
   * Members that take a seat; guests are not counted.
   *
   * @type {number}
   * @readonly
   */
  readonly memberCount: number;

  /**
   * Property role
   *
   * @description
   * Role of the reader in the organization, from the members of this service.
   *
   * @type {Role}
   * @readonly
   */
  readonly role: Role;

  /**
   * Property createdAt
   *
   * @description
   * When it was created.
   *
   * @type {Date}
   * @readonly
   */
  readonly createdAt: Date;

  /**
   * Property version
   *
   * @description
   * Version of the organization, its `ETag`.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;
  // #endregion
}
