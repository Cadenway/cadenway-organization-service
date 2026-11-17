/**
 * Interface InvitationOutcome
 *
 * @description
 * What became of one address of an invitation batch (`InvitationResult` of the contract):
 * `invited` with the new invitation, `already-member` without one, or `already-invited` with the
 * pending invitation of the address.
 */
export interface InvitationOutcome {
  // #region Properties
  /**
   * Property email
   *
   * @description
   * The address, trimmed and lowercased.
   *
   * @type {string}
   * @readonly
   */
  readonly email: string;

  /**
   * Property outcome
   *
   * @description
   * What became of it.
   *
   * @type {'invited' | 'already-member' | 'already-invited'}
   * @readonly
   */
  readonly outcome: 'invited' | 'already-member' | 'already-invited';

  /**
   * Property invitationId
   *
   * @description
   * The invitation created or pending, `null` for `already-member`.
   *
   * @type {string | null}
   * @readonly
   */
  readonly invitationId: string | null;
  // #endregion
}
