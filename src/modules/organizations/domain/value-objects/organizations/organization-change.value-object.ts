import type { DefaultLanguage } from './default-language.value-object.js';

/**
 * Interface OrganizationChange
 *
 * @description
 * A JSON Merge Patch of an organization (`OrganizationPatch` of `openapi/public/organizations.yaml`):
 * a member left out is unchanged, `null` clears `description` or `website`.
 */
export interface OrganizationChange {
  // #region Properties
  /**
   * Property name
   *
   * @description
   * New name, as typed.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly name?: string;

  /**
   * Property slug
   *
   * @description
   * New address.
   *
   * @type {string | undefined}
   * @readonly
   */
  readonly slug?: string;

  /**
   * Property description
   *
   * @description
   * New description, or `null` to clear it.
   *
   * @type {string | null | undefined}
   * @readonly
   */
  readonly description?: string | null;

  /**
   * Property website
   *
   * @description
   * New website, or `null` to clear it.
   *
   * @type {string | null | undefined}
   * @readonly
   */
  readonly website?: string | null;

  /**
   * Property defaultLanguage
   *
   * @description
   * New default language.
   *
   * @type {DefaultLanguage | undefined}
   * @readonly
   */
  readonly defaultLanguage?: DefaultLanguage;
  // #endregion
}
