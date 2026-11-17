/**
 * Interface AcceptInvitationInput
 *
 * @description
 * The acceptance of an invitation by the invitee ("Accepter").
 */
export interface AcceptInvitationInput {
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
   * Property userId
   *
   * @description
   * The account of the path, which must be the actor.
   *
   * @type {string}
   * @readonly
   */
  readonly userId: string;

  /**
   * Property invitationId
   *
   * @description
   * Id of the invitation, from the link of the email or the picker.
   *
   * @type {string}
   * @readonly
   */
  readonly invitationId: string;
  // #endregion
}
