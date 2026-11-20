/** Trusted candidate read from the service's bounded cleanup index. */
export interface AbandonOrganizationLogoUploadInput {
  // #region Properties
  /** Organization of the verified request. */
  readonly organizationId: string;

  /** Owner account bound to the reservation. */
  readonly uploaderUserId: string;

  /** Opaque owner reservation identifier. */
  readonly uploadId: string;
  // #endregion
}
