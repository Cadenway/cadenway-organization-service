/** The user and organization of the verified Search delegation. */
export interface GetSearchMembershipInput {
  // #region Properties
  /** Organization from the verified token. */
  readonly organizationId: string;

  /** User from the verified token. */
  readonly actorUserId: string;
  // #endregion
}
