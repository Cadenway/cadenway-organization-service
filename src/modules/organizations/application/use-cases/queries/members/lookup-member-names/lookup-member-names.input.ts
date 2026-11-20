/** Verified request context and validated account IDs for a member-name lookup. */
export interface LookupMemberNamesInput {
  // #region Properties
  /** The organization from the verified internal token. */
  readonly organizationId: string;

  /** The user from the verified internal token. */
  readonly actorUserId: string;

  /** Validated account IDs from the caller, with duplicates permitted. */
  readonly userIds: readonly string[];
  // #endregion
}
