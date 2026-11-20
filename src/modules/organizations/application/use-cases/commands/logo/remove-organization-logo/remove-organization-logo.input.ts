import type { OrganizationLogoActor } from '../../../../models/logo/organization-logo-actor.model.js';

/** Verified organization actor and optional profile version. */
export interface RemoveOrganizationLogoInput extends OrganizationLogoActor {
  // #region Properties
  /** Optional strong profile version. */
  readonly expectedVersion?: number;
  // #endregion
}
