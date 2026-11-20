/** Identity of an owner reservation and the verified uploader bound to it. */
export interface OrganizationLogoBinding {
  // #region Properties
  /** Organization that owns the logo. */
  readonly organizationId: string;

  /** Account whose upload is reserved. */
  readonly uploaderUserId: string;

  /** Owner-allocated UUID v7, reused as the immutable asset identifier. */
  readonly uploadId: string;
  // #endregion
}

const scopeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const mediaId = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Checks whether a value names a UUID actor or organization. */
export function isLogoScopeId(value: string): boolean {
  return scopeId.test(value);
}

/** Checks the UUID v7 shape required for profile media by the published contract. */
export function isLogoMediaId(value: string): boolean {
  return mediaId.test(value);
}

/** Compares full reservation identities, independent of UUID letter case. */
export function sameLogoBinding(
  first: OrganizationLogoBinding,
  second: OrganizationLogoBinding,
): boolean {
  return (
    first.organizationId.toLowerCase() === second.organizationId.toLowerCase() &&
    first.uploaderUserId.toLowerCase() === second.uploaderUserId.toLowerCase() &&
    first.uploadId.toLowerCase() === second.uploadId.toLowerCase()
  );
}
