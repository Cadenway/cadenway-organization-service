import type { PendingInvitationStatus } from '../../../domain/value-objects/invitations/pending-invitation-status.value-object.js';
import type { AssignableRole } from '../../../domain/value-objects/members/assignable-role.value-object.js';
import type { InviterView } from './inviter-view.projection.js';

/**
 * Interface InvitationView
 *
 * @description
 * A pending invitation as the pending list shows it (`Invitation` of the contract).
 */
export interface InvitationView {
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
   * Invited address.
   *
   * @type {string}
   * @readonly
   */
  readonly email: string;

  /**
   * Property role
   *
   * @description
   * Proposed role.
   *
   * @type {AssignableRole}
   * @readonly
   */
  readonly role: AssignableRole;

  /**
   * Property invitedBy
   *
   * @description
   * Who invited.
   *
   * @type {InviterView}
   * @readonly
   */
  readonly invitedBy: InviterView;

  /**
   * Property status
   *
   * @description
   * `pending` or `expired`.
   *
   * @type {PendingInvitationStatus}
   * @readonly
   */
  readonly status: PendingInvitationStatus;

  /**
   * Property sentAt
   *
   * @description
   * When the email was last sent.
   *
   * @type {Date}
   * @readonly
   */
  readonly sentAt: Date;

  /**
   * Property expiresAt
   *
   * @description
   * `sentAt` plus 7 days.
   *
   * @type {Date}
   * @readonly
   */
  readonly expiresAt: Date;

  /**
   * Property version
   *
   * @description
   * Version of the invitation, its `ETag`.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;
  // #endregion
}
