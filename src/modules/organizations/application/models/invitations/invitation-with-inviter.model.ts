import type { Invitation } from '../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { InviterView } from '../../projections/invitations/inviter-view.projection.js';

/**
 * Interface InvitationWithInviter
 *
 * @description
 * A stored invitation, in any state, with the sender as the lists name it.
 */
export interface InvitationWithInviter {
  // #region Properties
  /**
   * Property invitation
   *
   * @description
   * The invitation.
   *
   * @type {Invitation}
   * @readonly
   */
  readonly invitation: Invitation;

  /**
   * Property invitedBy
   *
   * @description
   * Its first sender, named from the user directory.
   *
   * @type {InviterView}
   * @readonly
   */
  readonly invitedBy: InviterView;
  // #endregion
}
