import type { AssignableRole } from '../../../domain/value-objects/members/assignable-role.value-object.js';
import type { InviterView } from './inviter-view.projection.js';
import type { InvitingOrganizationView } from './inviting-organization-view.projection.js';

/**
 * Interface ReceivedInvitationView
 *
 * @description
 * An invitation addressed to the reader ("Inès Robert vous invite comme Membre · expire le
 * 15 nov.", `ReceivedInvitation` of the contract).
 */
export interface ReceivedInvitationView {
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
   * Property organization
   *
   * @description
   * The organization that invites.
   *
   * @type {InvitingOrganizationView}
   * @readonly
   */
  readonly organization: InvitingOrganizationView;

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
   * Property expiresAt
   *
   * @description
   * When it stops working.
   *
   * @type {Date}
   * @readonly
   */
  readonly expiresAt: Date;
  // #endregion
}
