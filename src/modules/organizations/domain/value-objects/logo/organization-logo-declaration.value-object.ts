import { OrganizationLogoError } from '../../errors/logo/organization-logo.error.js';

const maximumLogoSourceBytes = 5_242_880;

/** Validated organization logo source declaration, separate from the prepared PNG. */
export interface OrganizationLogoDeclaration {
  // #region Properties
  /** The mockup and the profile-media contract accept PNG and SVG sources. */
  readonly contentType: 'image/png' | 'image/svg+xml';

  /** Declared source length in bytes, from one through five MiB. */
  readonly sizeBytes: number;
  // #endregion
}

/** Validates the owner's declaration before persisting the immutable reservation. */
export function declareOrganizationLogo(
  contentType: string,
  sizeBytes: number,
): OrganizationLogoDeclaration {
  if (contentType !== 'image/png' && contentType !== 'image/svg+xml') {
    throw new OrganizationLogoError('unsupported-type');
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new OrganizationLogoError('invalid-declaration');
  }
  if (sizeBytes > maximumLogoSourceBytes) throw new OrganizationLogoError('file-too-large');
  return { contentType, sizeBytes };
}
