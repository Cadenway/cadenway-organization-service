import { DomainError } from '../organizations/domain.error.js';

/**
 * Class InvitationDailyLimitReachedError
 *
 * @description
 * An invitation command that needs more emails than the sender or organization has left of its
 * allowance over the last 24 hours (`invitation.daily-limit-reached`, with `details.remaining` and
 * `details.nextAvailableAt`). The request is refused as a whole (decision 1 of the P2b security
 * follow-ups).
 */
export class InvitationDailyLimitReachedError extends DomainError {
  // #region Properties
  /**
   * Property remaining
   *
   * @description
   * The invitation emails the request can still send now, `0` or more.
   *
   * @type {number}
   * @readonly
   */
  public readonly remaining: number;

  /**
   * Property nextAvailableAt
   *
   * @description
   * When the allowance grows again: the oldest email counted plus 24 hours.
   *
   * @type {Date}
   * @readonly
   */
  public readonly nextAvailableAt: Date;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the request.
   *
   * @param {number} remaining - The emails the request can still send now.
   * @param {Date} nextAvailableAt - When the allowance grows again.
   * @constructor
   */
  public constructor(remaining: number, nextAvailableAt: Date) {
    super('The daily allowance of invitation emails has been reached.');
    this.remaining = remaining;
    this.nextAvailableAt = nextAvailableAt;
  }
  // #endregion
}
