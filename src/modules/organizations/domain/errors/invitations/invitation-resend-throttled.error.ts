import { DomainError } from '../organizations/domain.error.js';

/**
 * Class InvitationResendThrottledError
 *
 * @description
 * A resend less than an hour after the last sending of the invitation
 * (`invitation.resend-throttled`, with `details.resendAvailableAt`): its email goes out at most
 * once an hour (decision 1 of the P2b security follow-ups).
 */
export class InvitationResendThrottledError extends DomainError {
  // #region Properties
  /**
   * Property resendAvailableAt
   *
   * @description
   * When the invitation can be sent again: its last sending plus one hour.
   *
   * @type {Date}
   * @readonly
   */
  public readonly resendAvailableAt: Date;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the resend.
   *
   * @param {Date} resendAvailableAt - When the invitation can be sent again.
   * @constructor
   */
  public constructor(resendAvailableAt: Date) {
    super('The invitation was sent less than an hour ago.');
    this.resendAvailableAt = resendAvailableAt;
  }
  // #endregion
}
