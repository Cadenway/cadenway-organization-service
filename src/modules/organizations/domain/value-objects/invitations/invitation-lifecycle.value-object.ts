import type { InvitationLifecycleStatus } from './invitation-lifecycle-status.value-object.js';

/**
 * Interface InvitationLifecycle
 *
 * @description
 * Where an invitation stands at an instant, with the instants that closed it.
 */
export interface InvitationLifecycle {
  // #region Properties
  /**
   * Property status
   *
   * @description
   * The state at the instant.
   *
   * @type {InvitationLifecycleStatus}
   * @readonly
   */
  readonly status: InvitationLifecycleStatus;

  /**
   * Property answeredAt
   *
   * @description
   * When the invitee accepted or refused it, or `null`.
   *
   * @type {Date | null}
   * @readonly
   */
  readonly answeredAt: Date | null;

  /**
   * Property revokedAt
   *
   * @description
   * When an owner or an admin revoked it, or `null`.
   *
   * @type {Date | null}
   * @readonly
   */
  readonly revokedAt: Date | null;
  // #endregion
}
