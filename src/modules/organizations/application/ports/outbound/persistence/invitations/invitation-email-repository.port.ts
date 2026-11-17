import type { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { InvitationEmailUsage } from '../../../../../domain/value-objects/invitations/invitation-email-usage.value-object.js';

/**
 * Interface InvitationEmailRepository
 *
 * @description
 * The ledger of the invitation emails each organization caused, bound to the transaction of a unit
 * of work: one entry per issue or resend, kept 24 hours. The ledger, not `sentAt`, counts the
 * emails, since a resend overwrites the `sentAt` of its invitation.
 */
export interface InvitationEmailRepository {
  // #region Methods
  /**
   * Method lockUsage
   *
   * @description
   * Serializes the invitation emails of an organization until the end of the transaction, so that
   * two concurrent batches or resends cannot both pass the check of the same allowance, drops the
   * entries that left the window, and counts the ones in it.
   *
   * @param {string} organizationId - The organization of the transaction.
   * @param {Date} windowStart - The instant the window starts: an entry sent at it or before no
   * longer counts.
   * @returns {Promise<InvitationEmailUsage>} The emails counted after `windowStart`.
   */
  lockUsage(organizationId: string, windowStart: Date): Promise<InvitationEmailUsage>;

  /**
   * Method record
   *
   * @description
   * Records the email of an invitation just issued or resent, at its `sentAt`. The entry holds the
   * organization, the invitation and the instant only, never the address.
   *
   * @param {Invitation} invitation - The stored invitation after its issue or its resend.
   * @returns {Promise<void>} Resolves once recorded.
   */
  record(invitation: Invitation): Promise<void>;
  // #endregion
}
