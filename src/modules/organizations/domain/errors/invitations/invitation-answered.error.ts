import { DomainError } from '../organizations/domain.error.js';

/**
 * Class InvitationAnsweredError
 *
 * @description
 * A change to an invitation the invitee already accepted or refused (`invitation.answered`, with
 * `details.status`).
 */
export class InvitationAnsweredError extends DomainError {
  // #region Properties
  /**
   * Property status
   *
   * @description
   * How the invitee answered.
   *
   * @type {'accepted' | 'refused'}
   * @readonly
   */
  public readonly status: 'accepted' | 'refused';
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the change.
   *
   * @param {'accepted' | 'refused'} status - How the invitee answered.
   * @constructor
   */
  public constructor(status: 'accepted' | 'refused') {
    super('The invitation was answered already.');
    this.status = status;
  }
  // #endregion
}
