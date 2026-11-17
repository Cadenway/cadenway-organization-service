/**
 * Interface OrganizationFounding
 *
 * @description
 * What the creation form gives for a new organization ("Créer une organisation",
 * `Organisations.dc.html`).
 */
export interface OrganizationFounding {
  // #region Properties
  /**
   * Property name
   *
   * @description
   * Name as typed.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property slug
   *
   * @description
   * Address to use, or `null` to derive it from the name.
   *
   * @type {string | null}
   * @readonly
   */
  readonly slug: string | null;

  /**
   * Property teamSize
   *
   * @description
   * "Taille de l'équipe".
   *
   * @type {string}
   * @readonly
   */
  readonly teamSize: string;

  /**
   * Property primaryUse
   *
   * @description
   * "Usage principal".
   *
   * @type {string}
   * @readonly
   */
  readonly primaryUse: string;

  /**
   * Property ownerUserId
   *
   * @description
   * The creator, who becomes the owner.
   *
   * @type {string}
   * @readonly
   */
  readonly ownerUserId: string;
  // #endregion
}
