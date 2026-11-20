/** Owner state used by the gateway before asking Storage to prepare an image. */
export interface GetOrganizationLogoUploadOutput {
  // #region Properties
  /** Opaque owner reservation identifier. */
  readonly uploadId: string;

  /** Current owner reservation state. */
  readonly state: 'pending' | 'committed';

  /** Exclusive owner reservation deadline. */
  readonly expiresAt: Date;
  // #endregion
}
