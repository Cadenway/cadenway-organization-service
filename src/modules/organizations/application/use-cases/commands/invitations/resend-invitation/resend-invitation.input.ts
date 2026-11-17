/**
 * Interface ResendInvitationInput
 *
 * @description
 * A resend of a pending invitation of the organization of the request ("Renvoyer").
 */
export interface ResendInvitationInput {
  // #region Properties
  /**
   * Property actorUserId
   *
   * @description
   * The user of the verified internal token, the sender of the new email.
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
   * Id of the invitation.
   *
   * @type {string}
   * @readonly
   */
  readonly invitationId: string;
  // #endregion
}
