/** Original owner reservation and its exclusive expiry. */
export interface ReserveOrganizationLogoUploadOutput {
  // #region Properties
  /** Opaque owner reservation identifier. */
  readonly uploadId: string;

  /** Exclusive owner reservation deadline. */
  readonly expiresAt: Date;
  // #endregion
}
