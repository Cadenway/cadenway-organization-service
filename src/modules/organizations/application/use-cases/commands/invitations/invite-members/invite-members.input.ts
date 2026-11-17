import type { AssignableRole } from '../../../../../domain/value-objects/members/assignable-role.value-object.js';

/**
 * Interface InviteMembersInput
 *
 * @description
 * A batch of invitations to the organization of the request ("Inviter des membres").
 */
export interface InviteMembersInput {
  // #region Properties
  /**
   * Property actorUserId
   *
   * @description
   * The user of the verified internal token, the sender.
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
   * Property emails
   *
   * @description
   * Addresses to invite ("Adresses e-mail"), possibly repeated.
   *
   * @type {readonly string[]}
   * @readonly
   */
  readonly emails: readonly string[];

  /**
   * Property role
   *
   * @description
   * Role of every address of the batch ("Rôle").
   *
   * @type {AssignableRole}
   * @readonly
   */
  readonly role: AssignableRole;
  // #endregion
}
