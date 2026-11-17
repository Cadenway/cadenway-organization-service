import { DomainError } from '../organizations/domain.error.js';

/**
 * Class InvitationExpiredError
 *
 * @description
 * An answer to an invitation whose 7 days are over (`invitation.expired`, with
 * `details.expiresAt`). An owner or an admin can resend it.
 */
export class InvitationExpiredError extends DomainError {
  // #region Properties
  /**
   * Property expiresAt
   *
   * @description
   * When its 7 days ended.
   *
   * @type {Date}
   * @readonly
   */
  public readonly expiresAt: Date;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the answer.
   *
   * @param {Date} expiresAt - When the invitation stopped working.
   * @constructor
   */
  public constructor(expiresAt: Date) {
    super('The invitation expired.');
    this.expiresAt = expiresAt;
  }
  // #endregion
}
