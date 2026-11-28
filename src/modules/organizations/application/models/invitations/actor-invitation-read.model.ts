import type { Role } from '../../../domain/value-objects/members/role.value-object.js';
import type { InvitationWithInviter } from './invitation-with-inviter.model.js';

/**
 * Interface ActorInvitationRead
 *
 * @description
 * What one statement reads for `getInvitation`: the role of the actor's active membership and the
 * invitation of the organization, if any, from the same snapshot, at the same instant.
 */
export interface ActorInvitationRead {
  // #region Properties
  /**
   * Property actorRole
   *
   * @description
   * The role of the actor's active membership.
   *
   * @type {Role}
   * @readonly
   */
  readonly actorRole: Role;

  /**
   * Property invitation
   *
   * @description
   * The invitation with its sender and the instant of the read, or `null` when the organization has
   * no invitation with that id.
   *
   * @type {InvitationWithInviter | null}
   * @readonly
   */
  readonly invitation: InvitationWithInviter | null;
  // #endregion
}
