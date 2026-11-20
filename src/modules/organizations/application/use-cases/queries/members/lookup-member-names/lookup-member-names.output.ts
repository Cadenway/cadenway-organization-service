import type { MemberName } from '../../../../projections/members/member-name.projection.js';

/** Names found for the requested active members of the request organization. */
export interface LookupMemberNamesOutput {
  // #region Properties
  /** Each returned account appears once. Missing names and memberships are omitted. */
  readonly items: readonly MemberName[];
  // #endregion
}
