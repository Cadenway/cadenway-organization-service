/**
 * Interface GetCurrentOrganizationInput
 *
 * @description
 * Who reads the organization of the request ("Profil de l'organisation").
 */
export interface GetCurrentOrganizationInput {
  // #region Properties
  /**
   * Property actorUserId
   *
   * @description
   * The user of the verified internal token.
   *
   * @type {string}
   * @readonly
   */
  readonly actorUserId: string;

  /**
   * Property organizationId
   *
   * @description
   * The organization of the verified internal token.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationId: string;
  // #endregion
}
