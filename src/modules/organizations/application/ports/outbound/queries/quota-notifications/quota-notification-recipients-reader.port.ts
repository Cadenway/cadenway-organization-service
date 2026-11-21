/**
 * Reads current owner and administrator user IDs for the signed organization.
 * The caller checks that the organization exists in the same read snapshot.
 */
export interface QuotaNotificationRecipientsReader {
  // #region Methods
  /** Reads eligible IDs in ascending order, using the previous page's last user ID. */
  listActive(
    organizationId: string,
    afterUserId: string | null,
    limit: number,
  ): Promise<readonly string[]>;

  /** Revalidates the current roles of the requested users in the organization. */
  findActive(organizationId: string, userIds: readonly string[]): Promise<readonly string[]>;
  // #endregion
}
