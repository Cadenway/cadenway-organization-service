import type { OrganizationLogoActor } from '../../../../models/logo/organization-logo-actor.model.js';

/** The signed-in uploader and opaque reservation ID. */
export interface GetOrganizationLogoUploadInput extends OrganizationLogoActor {
  // #region Properties
  /** Opaque owner reservation identifier. */
  readonly uploadId: string;
  // #endregion
}
