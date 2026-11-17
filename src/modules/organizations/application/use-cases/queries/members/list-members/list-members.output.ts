import type { Page } from '../../../../models/pagination/page.model.js';
import type { MemberView } from '../../../../projections/members/member-view.projection.js';
import type { RoleCounts } from '../../../../projections/members/role-counts.projection.js';

/**
 * Interface ListMembersOutput
 *
 * @description
 * One page of members, the count of those that match the filters ("{a}–{b} sur {n} personnes") and
 * the counts by role of the whole organization (`MemberPage` of the contract).
 */
export interface ListMembersOutput {
  // #region Properties
  /**
   * Property page
   *
   * @description
   * The page.
   *
   * @type {Page<MemberView>}
   * @readonly
   */
  readonly page: Page<MemberView>;

  /**
   * Property total
   *
   * @description
   * Members that match the filters, on every page.
   *
   * @type {number}
   * @readonly
   */
  readonly total: number;

  /**
   * Property counts
   *
   * @description
   * Members by role, whatever the filters.
   *
   * @type {RoleCounts}
   * @readonly
   */
  readonly counts: RoleCounts;
  // #endregion
}
