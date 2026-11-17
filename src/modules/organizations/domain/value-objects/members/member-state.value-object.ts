import type { Role } from './role.value-object.js';

/**
 * Interface MemberState
 *
 * @description
 * A stored membership: an account in an organization with a role. A removed membership is kept,
 * removed, so that its version stays the last one its events carried.
 */
export interface MemberState {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id of the membership, the `memberId` of the routes and events; assigned by PostgreSQL.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property organizationId
   *
   * @description
   * The organization.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationId: string;

  /**
   * Property userId
   *
   * @description
   * Account of the member.
   *
   * @type {string}
   * @readonly
   */
  readonly userId: string;

  /**
   * Property role
   *
   * @description
   * Its role; the role it had for a removed membership.
   *
   * @type {Role}
   * @readonly
   */
  readonly role: Role;

  /**
   * Property invitationId
   *
   * @description
   * Invitation accepted to join, `null` for the owner at the creation.
   *
   * @type {string | null}
   * @readonly
   */
  readonly invitationId: string | null;

  /**
   * Property joinedAt
   *
   * @description
   * When the membership began.
   *
   * @type {Date}
   * @readonly
   */
  readonly joinedAt: Date;

  /**
   * Property removedAt
   *
   * @description
   * When it was removed, or `null` while it is active.
   *
   * @type {Date | null}
   * @readonly
   */
  readonly removedAt: Date | null;

  /**
   * Property version
   *
   * @description
   * Version of the membership: 1 when it begins, one more at each change of role and at the
   * removal. Its `ETag` and the `version` of its events.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;
  // #endregion
}
