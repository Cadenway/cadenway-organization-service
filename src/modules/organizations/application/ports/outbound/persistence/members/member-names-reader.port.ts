import type { MemberName } from '../../../../projections/members/member-name.projection.js';

/** Tenant-scoped membership and name reads bound to one consistent snapshot. */
export interface MemberNamesReader {
  // #region Methods
  /** Checks whether the requesting account has an active membership in the organization. */
  findActiveActor(organizationId: string, actorUserId: string): Promise<boolean>;

  /** Returns names for the requested active members with a nonempty directory name. */
  findActiveNames(
    organizationId: string,
    userIds: readonly string[],
  ): Promise<readonly MemberName[]>;
  // #endregion
}
