import type { AssignableRole } from '../members/assignable-role.value-object.js';
import type { InvitationStatus } from './invitation-status.value-object.js';

/**
 * Interface InvitationState
 *
 * @description
 * A stored invitation of an address to join an organization with a role.
 */
export interface InvitationState {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id assigned by PostgreSQL, the last segment of the link of the email; not a secret
   * (decision 5 of P2b).
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property organizationId
   *
   * @description
   * The organization the address is invited to.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationId: string;

  /**
   * Property email
   *
   * @description
   * The invited address, trimmed and lowercased.
   *
   * @type {string}
   * @readonly
   */
  readonly email: string;

  /**
   * Property role
   *
   * @description
   * Role proposed ("Rôle proposé").
   *
   * @type {AssignableRole}
   * @readonly
   */
  readonly role: AssignableRole;

  /**
   * Property invitedByUserId
   *
   * @description
   * The owner or the admin who invited ("Invité par {nom}").
   *
   * @type {string}
   * @readonly
   */
  readonly invitedByUserId: string;

  /**
   * Property status
   *
   * @description
   * Stored state.
   *
   * @type {InvitationStatus}
   * @readonly
   */
  readonly status: InvitationStatus;

  /**
   * Property sentAt
   *
   * @description
   * When the email was last sent; a resend moves it.
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
   * Property answeredAt
   *
   * @description
   * When it was accepted, refused or revoked, or `null` while pending.
   *
   * @type {Date | null}
   * @readonly
   */
  readonly answeredAt: Date | null;

  /**
   * Property version
   *
   * @description
   * Version: 1 when issued, one more at each resend and at the end of its life. Its `ETag` and the
   * `version` of `invitation.issued.v1`.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;
  // #endregion
}
