import type { SearchOrganizationPosition } from '../../../../models/search/search-organization-position.model.js';

/** An ID-only page and the position of its continuation, if any. */
export interface ListSearchOrganizationsOutput {
  // #region Properties
  /** Organization IDs in ascending order. */
  readonly items: readonly string[];

  /** Position of the next page, or null at completion. */
  readonly next: SearchOrganizationPosition | null;
  // #endregion
}
