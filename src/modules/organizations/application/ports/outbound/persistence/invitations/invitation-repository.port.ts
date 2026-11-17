import type { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { EmailAddress } from '../../../../../domain/value-objects/email/email-address.value-object.js';
import type { InvitationDraft } from '../../../../../domain/value-objects/invitations/invitation-draft.value-object.js';
import type { Page } from '../../../../models/pagination/page.model.js';
import type { PagePosition } from '../../../../models/pagination/page-position.model.js';
import type { InvitationView } from '../../../../projections/invitations/invitation-view.projection.js';
import type { ReceivedInvitationView } from '../../../../projections/invitations/received-invitation-view.projection.js';

/**
 * Interface InvitationRepository
 *
 * @description
 * The invitations, bound to the transaction of a unit of work. One pending invitation at most per
 * organization and address.
 */
export interface InvitationRepository {
  // #region Methods
  /**
   * Method insertPending
   *
   * @description
   * Stores a new pending invitation unless the address has one in the organization already;
   * PostgreSQL assigns its id.
   *
   * @param {InvitationDraft} draft - The invitation to store.
   * @returns {Promise<Invitation | null>} The stored invitation, or `null` when a pending
   * invitation of the address exists, a concurrent one included.
   */
  insertPending(draft: InvitationDraft): Promise<Invitation | null>;

  /**
   * Method findPendingTo
   *
   * @description
   * Loads the pending invitation of an address in an organization, expired or not.
   *
   * @param {string} organizationId - The organization.
   * @param {EmailAddress} email - The address.
   * @returns {Promise<Invitation | null>} The invitation, or `null`.
   */
  findPendingTo(organizationId: string, email: EmailAddress): Promise<Invitation | null>;

  /**
   * Method findForUpdate
   *
   * @description
   * Loads an invitation of an organization by its id and locks it until the end of the
   * transaction.
   *
   * @param {string} organizationId - The organization.
   * @param {string} invitationId - Id of the invitation.
   * @returns {Promise<Invitation | null>} The invitation, or `null`.
   */
  findForUpdate(organizationId: string, invitationId: string): Promise<Invitation | null>;

  /**
   * Method find
   *
   * @description
   * Loads an invitation by its id alone, whatever its organization. Only in a system transaction,
   * for the invitee, who belongs to no organization of the invitation yet.
   *
   * @param {string} invitationId - Id of the invitation.
   * @returns {Promise<Invitation | null>} The invitation, or `null`.
   */
  find(invitationId: string): Promise<Invitation | null>;

  /**
   * Method update
   *
   * @description
   * Writes the state of an invitation locked by `findForUpdate`.
   *
   * @param {Invitation} invitation - The invitation after the change.
   * @returns {Promise<void>} Resolves once written.
   */
  update(invitation: Invitation): Promise<void>;

  /**
   * Method listPending
   *
   * @description
   * One page of the pending invitations of an organization, expired included, the most recently
   * sent first, with the name of their sender.
   *
   * @param {string} organizationId - The organization.
   * @param {Date} now - The instant that tells `pending` from `expired`.
   * @param {PagePosition | null} after - Where the previous page ended, or `null`.
   * @param {number} limit - Page size.
   * @returns {Promise<Page<InvitationView>>} The page.
   */
  listPending(
    organizationId: string,
    now: Date,
    after: PagePosition | null,
    limit: number,
  ): Promise<Page<InvitationView>>;

  /**
   * Method countPending
   *
   * @description
   * Counts the pending invitations of an organization, expired included.
   *
   * @param {string} organizationId - The organization.
   * @returns {Promise<number>} The count.
   */
  countPending(organizationId: string): Promise<number>;

  /**
   * Method listReceived
   *
   * @description
   * One page of the pending invitations, not expired, sent to an address by any organization, the
   * most recently sent first. Reads across organizations: only in a system transaction.
   *
   * @param {EmailAddress} email - The verified address of the invitee.
   * @param {Date} now - The instant before which they expire.
   * @param {PagePosition | null} after - Where the previous page ended, or `null`.
   * @param {number} limit - Page size.
   * @returns {Promise<Page<ReceivedInvitationView>>} The page.
   */
  listReceived(
    email: EmailAddress,
    now: Date,
    after: PagePosition | null,
    limit: number,
  ): Promise<Page<ReceivedInvitationView>>;
  // #endregion
}
