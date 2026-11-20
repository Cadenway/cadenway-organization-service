/** Binds a continuation to the original scan's upper bound and last returned organization. */
export interface SearchOrganizationPosition {
  // #region Properties
  /** Inclusive upper organization ID fixed by the first page. */
  readonly upperId: string;

  /** Last organization ID returned to the caller. */
  readonly afterId: string;
  // #endregion
}
