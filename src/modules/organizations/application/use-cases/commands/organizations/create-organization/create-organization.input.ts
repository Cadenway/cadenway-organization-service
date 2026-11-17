/**
 * Interface CreateOrganizationInput
 *
 * @description
 * The creation form ("Créer une organisation") and its creator (`OrganizationCreation` of the
 * contract).
 */
export interface CreateOrganizationInput {
  // #region Properties
  /**
   * Property actorUserId
   *
   * @description
   * The user of the verified internal token, the future owner.
   *
   * @type {string}
   * @readonly
   */
  readonly actorUserId: string;

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
   * Property inviteEmails
   *
   * @description
   * Addresses to invite as `member` ("Inviter des collègues"), possibly repeated.
   *
   * @type {readonly string[]}
   * @readonly
   */
  readonly inviteEmails: readonly string[];
  // #endregion
}
