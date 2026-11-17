/**
 * Interface InvitingOrganizationView
 *
 * @description
 * The organization of an invitation as the invitee sees it before joining
 * (`InvitingOrganization` of the contract).
 */
export interface InvitingOrganizationView {
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
   * Description ("Affichée sur la page d'invitation."), or `null`.
   *
   * @type {string | null}
   * @readonly
   */
  readonly description: string | null;

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
  // #endregion
}
