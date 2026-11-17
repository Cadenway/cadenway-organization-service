/**
 * Interface InvitationMail
 *
 * @description
 * What the email of an invitation shows besides the invitation itself (`invitation.issued.v1`):
 * "{inviter.name} vous invite à rejoindre l'organisation {organization.name}", the member count of
 * its header, and its language.
 */
export interface InvitationMail {
  // #region Properties
  /**
   * Property inviterUserId
   *
   * @description
   * The owner or the admin who sends it, also the actor of the event.
   *
   * @type {string}
   * @readonly
   */
  readonly inviterUserId: string;

  /**
   * Property inviterName
   *
   * @description
   * Full name of the sender, from the user directory.
   *
   * @type {string}
   * @readonly
   */
  readonly inviterName: string;

  /**
   * Property organizationName
   *
   * @description
   * Name of the organization.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationName: string;

  /**
   * Property memberCount
   *
   * @description
   * Members that take a seat when it is sent ("18 membres").
   *
   * @type {number}
   * @readonly
   */
  readonly memberCount: number;

  /**
   * Property language
   *
   * @description
   * Default language of the organization, the language of the email.
   *
   * @type {string}
   * @readonly
   */
  readonly language: string;
  // #endregion
}
