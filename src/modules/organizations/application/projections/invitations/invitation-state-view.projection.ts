import type { InvitationLifecycleStatus } from '../../../domain/value-objects/invitations/invitation-lifecycle-status.value-object.js';
import type { AssignableRole } from '../../../domain/value-objects/members/assignable-role.value-object.js';
import type { InviterView } from './inviter-view.projection.js';

/**
 * Interface InvitationStateView
 *
 * @description
 * An invitation of the organization in any state of its lifecycle (`InvitationState` of
 * `openapi/internal/organization-service.yaml`).
 */
export interface InvitationStateView {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id of the invitation.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property email
   *
   * @description
   * The invited address.
   *
   * @type {string}
   * @readonly
   */
  readonly email: string;

  /**
   * Property role
   *
   * @description
   * The proposed role.
   *
   * @type {AssignableRole}
   * @readonly
   */
  readonly role: AssignableRole;

  /**
   * Property invitedBy
   *
   * @description
   * The first sender.
   *
   * @type {InviterView}
   * @readonly
   */
  readonly invitedBy: InviterView;

  /**
   * Property status
   *
   * @description
   * Its state at the read.
   *
   * @type {InvitationLifecycleStatus}
   * @readonly
   */
  readonly status: InvitationLifecycleStatus;

  /**
   * Property sentAt
   *
   * @description
   * When it was last sent.
   *
   * @type {Date}
   * @readonly
   */
  readonly sentAt: Date;

  /**
   * Property expiresAt
   *
   * @description
   * When it expires, or expired.
   *
   * @type {Date}
   * @readonly
   */
  readonly expiresAt: Date;

  /**
   * Property answeredAt
   *
   * @description
   * When it was accepted or refused, or `null`.
   *
   * @type {Date | null}
   * @readonly
   */
  readonly answeredAt: Date | null;

  /**
   * Property revokedAt
   *
   * @description
   * When it was revoked, or `null`.
   *
   * @type {Date | null}
   * @readonly
   */
  readonly revokedAt: Date | null;

  /**
   * Property version
   *
   * @description
   * Its version.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;
  // #endregion
}
