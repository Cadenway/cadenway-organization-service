/** Organization-owned reference and generations, read from the locked organization row. */
export interface OrganizationLogoState {
  // #region Properties
  /** The owning organization. */
  readonly organizationId: string;

  /** Immutable Storage reference, or null when the organization has no logo. */
  readonly assetId: string | null;

  /** Image generation that also fences pending uploads. */
  readonly generation: number;

  /** The organization profile version used for its strong ETag. */
  readonly profileVersion: number;
  // #endregion
}
