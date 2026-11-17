import { DomainError } from '../organizations/domain.error.js';

/**
 * Class InvitationRevokedError
 *
 * @description
 * An answer to, or a resend of, an invitation an owner or an admin revoked ("Annuler",
 * `invitation.revoked`).
 */
export class InvitationRevokedError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the change.
   *
   * @constructor
   */
  public constructor() {
    super('The invitation was revoked.');
  }
  // #endregion
}
