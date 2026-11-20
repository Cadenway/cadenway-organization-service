import type { OrganizationLogoActor } from '../../../../models/logo/organization-logo-actor.model.js';

/** Validated declaration and optional request key from the authenticated uploader. */
export interface ReserveOrganizationLogoUploadInput extends OrganizationLogoActor {
  // #region Properties
  /** Declared source content type. */
  readonly contentType: string;

  /** Declared source size in bytes. */
  readonly sizeBytes: number;

  /** Optional caller request key. */
  readonly idempotencyKey?: string;
  // #endregion
}
