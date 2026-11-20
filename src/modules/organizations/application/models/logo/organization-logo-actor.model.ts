/** Identity derived from the verified internal request context. */
export interface OrganizationLogoActor {
  // #region Properties
  /** Organization of the verified request. */
  readonly organizationId: string;

  /** Account of the verified actor. */
  readonly actorUserId: string;
  // #endregion
}
