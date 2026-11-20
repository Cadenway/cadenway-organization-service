/** Terminal owner decision mapped to organization.logo-upload-abandoned.v1 in the outbox. */
export interface OrganizationLogoUploadAbandoned {
  // #region Properties
  /** Organization that owns the permanently abandoned reservation. */
  readonly organizationId: string;

  /** Opaque reservation ID consumed by Storage to fence preparation and collect the bytes. */
  readonly uploadId: string;
  // #endregion
}
