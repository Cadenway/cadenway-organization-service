import type { DefaultLanguage } from './default-language.value-object.js';
import type { Plan } from './plan.value-object.js';

/**
 * Interface OrganizationState
 *
 * @description
 * A stored organization: its profile ("Profil de l'organisation", `Organisation.dc.html`), its
 * plan, the answers of the creation form and its owner.
 */
export interface OrganizationState {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id assigned by PostgreSQL.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property name
   *
   * @description
   * Name ("Nom"), trimmed, 1 to 120 characters.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property slug
   *
   * @description
   * Address ("Adresse"), unique across organizations.
   *
   * @type {string}
   * @readonly
   */
  readonly slug: string;

  /**
   * Property description
   *
   * @description
   * "Description (facultatif)", up to 280 characters, or `null`.
   *
   * @type {string | null}
   * @readonly
   */
  readonly description: string | null;

  /**
   * Property website
   *
   * @description
   * "Site web", an absolute http or https URL, or `null`.
   *
   * @type {string | null}
   * @readonly
   */
  readonly website: string | null;

  /** Current opaque logo reference, assigned through the logo owner operation. */
  readonly logoId?: string | null;

  /**
   * Property defaultLanguage
   *
   * @description
   * "Langue par défaut".
   *
   * @type {DefaultLanguage}
   * @readonly
   */
  readonly defaultLanguage: DefaultLanguage;

  /**
   * Property plan
   *
   * @description
   * The plan, `free` until billing exists.
   *
   * @type {Plan}
   * @readonly
   */
  readonly plan: Plan;

  /**
   * Property teamSize
   *
   * @description
   * "Taille de l'équipe" of the creation form, a value of the contract enumeration.
   *
   * @type {string}
   * @readonly
   */
  readonly teamSize: string;

  /**
   * Property primaryUse
   *
   * @description
   * "Usage principal" of the creation form, a value of the contract enumeration.
   *
   * @type {string}
   * @readonly
   */
  readonly primaryUse: string;

  /**
   * Property ownerUserId
   *
   * @description
   * Account of the owner, the creator.
   *
   * @type {string}
   * @readonly
   */
  readonly ownerUserId: string;

  /**
   * Property createdAt
   *
   * @description
   * When the organization was created.
   *
   * @type {Date}
   * @readonly
   */
  readonly createdAt: Date;

  /**
   * Property version
   *
   * @description
   * Version of the organization: 1 at its creation, one more at each change. Its `ETag`.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;
  // #endregion
}
