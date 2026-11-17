import type { Page } from '../../../../models/pagination/page.model.js';
import type { InvitationView } from '../../../../projections/invitations/invitation-view.projection.js';

/**
 * Interface ListInvitationsOutput
 *
 * @description
 * One page of pending invitations and their count on every page (`InvitationPage`).
 */
export interface ListInvitationsOutput {
  // #region Properties
  /**
   * Property page
   *
   * @description
   * The page.
   *
   * @type {Page<InvitationView>}
   * @readonly
   */
  readonly page: Page<InvitationView>;

  /**
   * Property total
   *
   * @description
   * Pending invitations of the organization, expired included.
   *
   * @type {number}
   * @readonly
   */
  readonly total: number;
  // #endregion
}
