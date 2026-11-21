/** Verified caller and requested account for an organization membership check. */
export interface CheckAutomationRecipientInput {
  // #region Properties
  /** Organization from the verified internal token. */
  readonly organizationId: string;

  /** Caller from the verified internal token. */
  readonly actorUserId: string;

  /** Account whose current membership is checked. */
  readonly userId: string;
  // #endregion
}
