import type { OrganizationLogoActor } from '../../../../models/logo/organization-logo-actor.model.js';

/** Gateway-verified reservation and optional strong profile version. */
export interface PublishOrganizationLogoInput extends OrganizationLogoActor {
  // #region Properties
  /** Opaque owner reservation identifier. */
  readonly uploadId: string;

  /** Optional strong profile version. */
  readonly expectedVersion?: number;
  // #endregion
}
