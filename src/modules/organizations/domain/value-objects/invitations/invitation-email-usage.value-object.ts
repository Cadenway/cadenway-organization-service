/**
 * Interface InvitationEmailUsage
 *
 * @description
 * The invitation emails an organization caused in the 24 hours before an instant: every issue,
 * from a batch or from the creation of the organization, and every resend (decision 1 of the P2b
 * security follow-ups).
 */
export interface InvitationEmailUsage {
  // #region Properties
  /**
   * Property count
   *
   * @description
   * How many invitation emails the organization caused in the window, `0` or more.
   *
   * @type {number}
   * @readonly
   */
  readonly count: number;

  /**
   * Property oldestSentAt
   *
   * @description
   * When the oldest email counted went out; `null` when none is counted.
   *
   * @type {Date | null}
   * @readonly
   */
  readonly oldestSentAt: Date | null;
  // #endregion
}
