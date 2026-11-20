import type { SearchOrganizationPosition } from '../../../../models/search/search-organization-position.model.js';

/** The verified page position and validated page size. */
export interface ListSearchOrganizationsInput {
  // #region Properties
  /** Position of a continuing scan, or null when the scan begins. */
  readonly position: SearchOrganizationPosition | null;

  /** Maximum organization IDs to return. */
  readonly limit: number;
  // #endregion
}
