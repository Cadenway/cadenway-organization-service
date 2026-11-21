/** Current eligibility of the requested account in the caller's organization. */
export interface CheckAutomationRecipientOutput {
  // #region Properties
  /** True when the account has an active membership. */
  readonly eligible: boolean;
  // #endregion
}
