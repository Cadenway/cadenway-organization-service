import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, count, eq, gt, lte, min } from 'drizzle-orm';

import type { InvitationEmailRepository } from '../../../../../application/ports/outbound/persistence/invitations/invitation-email-repository.port.js';
import type { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { InvitationEmailUsage } from '../../../../../domain/value-objects/invitations/invitation-email-usage.value-object.js';
import type { InvitationState } from '../../../../../domain/value-objects/invitations/invitation-state.value-object.js';
import { invitationEmails } from '../../schemas/invitations/invitation-email.schema.js';
import { organizations } from '../../schemas/organizations/organization.schema.js';

/**
 * Class DrizzleInvitationEmailRepository
 *
 * @description
 * `InvitationEmailRepository` on `invitation_emails`, in the transaction of its unit of work. Every
 * query filters on its organization.
 *
 * `lockUsage` serializes the writers of the ledger of an organization with a row lock on the
 * organization itself (`select … for no key update`), held until the end of the transaction: a
 * second batch or resend of the same organization waits there, then counts what the first one
 * committed, so two concurrent requests cannot both pass the check of the same allowance. The count
 * sees that commit because it is a statement of its own after the lock, under READ COMMITTED, the
 * isolation the transaction runners of the kit open (a plain `begin`); a snapshot taken before the
 * lock, as REPEATABLE READ would keep, would not. This
 * lock leaves the key of the organization alone, so the foreign keys of concurrent inserts into
 * its other tables (`for key share`) never wait on it; a patch of the organization
 * (`for update`) and the batches of the organization run one after the other. Every writer locks
 * the organization before any invitation, so the locks are always taken in the same order.
 */
export class DrizzleInvitationEmailRepository implements InvitationEmailRepository {
  // #region Properties
  /**
   * Property db
   *
   * @description
   * The Drizzle database of the transaction.
   *
   * @type {TransactionDatabase}
   * @readonly
   */
  private readonly db: TransactionDatabase;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Binds the repository to a transaction.
   *
   * @param {TransactionDatabase} db - The Drizzle database of the transaction.
   * @constructor
   */
  public constructor(db: TransactionDatabase) {
    this.db = db;
  }
  // #endregion

  // #region Methods
  /**
   * Method lockUsage
   *
   * @description
   * Locks the organization for the transaction, deletes its entries sent at `windowStart` or
   * before, and counts the others with the oldest of them.
   *
   * @param {string} organizationId - The organization of the transaction.
   * @param {Date} windowStart - The instant the window starts.
   * @returns {Promise<InvitationEmailUsage>} The emails counted after `windowStart`.
   */
  public async lockUsage(organizationId: string, windowStart: Date): Promise<InvitationEmailUsage> {
    await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .for('no key update');
    await this.db
      .delete(invitationEmails)
      .where(
        and(
          eq(invitationEmails.organizationId, organizationId),
          lte(invitationEmails.sentAt, windowStart),
        ),
      );
    const rows: { readonly count: number; readonly oldestSentAt: Date | null }[] = await this.db
      .select({ count: count(), oldestSentAt: min(invitationEmails.sentAt) })
      .from(invitationEmails)
      .where(
        and(
          eq(invitationEmails.organizationId, organizationId),
          gt(invitationEmails.sentAt, windowStart),
        ),
      );
    return { count: rows[0]?.count ?? 0, oldestSentAt: rows[0]?.oldestSentAt ?? null };
  }

  /**
   * Method record
   *
   * @description
   * Inserts the entry of the email of an invitation at its `sentAt`.
   *
   * @param {Invitation} invitation - The stored invitation after its issue or its resend.
   * @returns {Promise<void>} Resolves once inserted.
   */
  public async record(invitation: Invitation): Promise<void> {
    const state: InvitationState = invitation.snapshot;
    await this.db.insert(invitationEmails).values({
      organizationId: state.organizationId,
      invitationId: state.id,
      sentAt: state.sentAt,
    });
  }
  // #endregion
}
