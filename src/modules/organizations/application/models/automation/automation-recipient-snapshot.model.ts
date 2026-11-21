import type { Role } from '../../../domain/value-objects/members/role.value-object.js';

/** Membership decisions read together in the organization snapshot. */
export interface AutomationRecipientSnapshot {
  // #region Properties
  /** The caller's current active role, or null when the caller is not a member. */
  readonly actorRole: Role | null;

  /** Whether the requested account has an active membership, including as a guest. */
  readonly eligible: boolean;
  // #endregion
}
