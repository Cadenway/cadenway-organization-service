import type { AssignableRole } from '../../../../../domain/value-objects/members/assignable-role.value-object.js';
import type { VersionCondition } from '../../../../models/versions/version-condition.model.js';

/**
 * Interface ChangeMemberRoleInput
 *
 * @description
 * A change of role of a member of the organization of the request (the role select of "Membres").
 */
export interface ChangeMemberRoleInput {
  // #region Properties
  /**
   * Property actorUserId
   *
   * @description
   * The user of the verified internal token.
   *
   * @type {string}
   * @readonly
   */
  readonly actorUserId: string;

  /**
   * Property organizationId
   *
   * @description
   * The organization of the verified internal token.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationId: string;

  /**
   * Property memberId
   *
   * @description
   * Id of the membership.
   *
   * @type {string}
   * @readonly
   */
  readonly memberId: string;

  /**
   * Property role
   *
   * @description
   * The new role, never `owner`.
   *
   * @type {AssignableRole}
   * @readonly
   */
  readonly role: AssignableRole;

  /**
   * Property expectedVersion
   *
   * @description
   * The `If-Match` of the request.
   *
   * @type {VersionCondition}
   * @readonly
   */
  readonly expectedVersion: VersionCondition;
  // #endregion
}
