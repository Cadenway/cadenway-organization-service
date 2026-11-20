/** Domain fact mapped to organization.logo-changed.v1 in the owner transaction. */
export interface OrganizationLogoChanged {
  // #region Properties
  /** Organization whose reference changed. */
  readonly organizationId: string;

  /** Current owner or admin who authorized the change. */
  readonly actorUserId: string;

  /** Monotonically increasing logo generation. */
  readonly generation: number;

  /** The new active immutable asset, or null when removed. */
  readonly assetId: string | null;

  /** The retired immutable asset, or null on first adoption. */
  readonly oldAssetId: string | null;
  // #endregion
}
