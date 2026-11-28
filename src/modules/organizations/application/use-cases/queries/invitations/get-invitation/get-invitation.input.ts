/**
 * Interface GetInvitationInput
 *
 * @description
 * The read of one invitation of the organization of the request.
 */
export interface GetInvitationInput {
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

  /**
   * Property invitationId
   *
   * @description
   * Id of the invitation, from the path.
   *
   * @type {string}
   * @readonly
   */
  readonly invitationId: string;
  // #endregion
}
