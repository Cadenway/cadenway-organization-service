/**
 * Interface GetMemberInput
 *
 * @description
 * One member of the organization of the request.
 */
export interface GetMemberInput {
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
   * Property memberId
   *
   * @description
   * Id of the membership.
   *
   * @type {string}
   * @readonly
   */
  readonly memberId: string;
  // #endregion
}
