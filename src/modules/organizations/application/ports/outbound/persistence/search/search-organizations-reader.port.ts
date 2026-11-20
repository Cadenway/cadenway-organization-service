import type { SearchOrganizationPosition } from '../../../../models/search/search-organization-position.model.js';

/** Reads a bounded sequence of organization IDs from one snapshot. */
export interface SearchOrganizationsReader {
  // #region Methods
  /** Reuses the continuation's upper bound or fixes it in the first snapshot. */
  read(
    position: SearchOrganizationPosition | null,
    maximum: number,
  ): Promise<{ readonly upperId: string | null; readonly items: readonly string[] }>;
  // #endregion
}
