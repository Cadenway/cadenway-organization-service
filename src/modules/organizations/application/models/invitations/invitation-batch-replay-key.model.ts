/**
 * Interface InvitationBatchReplayKey
 *
 * @description
 * The scope of an `Idempotency-Key` of `inviteMembers`: the verified organization, the acting user
 * and the key itself, the operation being the invitation batch. The same key in another
 * organization or from another user is another key (`openapi/internal/organization-service.yaml`).
 */
export interface InvitationBatchReplayKey {
  // #region Properties
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
   * Property key
   *
   * @description
   * The `Idempotency-Key` the client chose, as validated by the contract (1 to 255 characters).
   * Stored as a digest only.
   *
   * @type {string}
   * @readonly
   */
  readonly key: string;
  // #endregion
}
