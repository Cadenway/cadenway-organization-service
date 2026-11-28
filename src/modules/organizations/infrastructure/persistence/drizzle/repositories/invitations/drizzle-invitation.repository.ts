import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { InvitationWithInviter } from '../../../../../application/models/invitations/invitation-with-inviter.model.js';
import type { Page } from '../../../../../application/models/pagination/page.model.js';
import type { PagePosition } from '../../../../../application/models/pagination/page-position.model.js';
import type { InvitationRepository } from '../../../../../application/ports/outbound/persistence/invitations/invitation-repository.port.js';
import type { InvitationView } from '../../../../../application/projections/invitations/invitation-view.projection.js';
import type { ReceivedInvitationView } from '../../../../../application/projections/invitations/received-invitation-view.projection.js';
import { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { EmailAddress } from '../../../../../domain/value-objects/email/email-address.value-object.js';
import type { InvitationDraft } from '../../../../../domain/value-objects/invitations/invitation-draft.value-object.js';
import type { InvitationState } from '../../../../../domain/value-objects/invitations/invitation-state.value-object.js';
import type { AssignableRole } from '../../../../../domain/value-objects/members/assignable-role.value-object.js';
import { FORMER_MEMBER_NAME } from '../../../../../domain/value-objects/directory/former-member-name.value-object.js';
import { toInvitation } from '../../mappers/invitations/invitation.mapper.js';
import type { InvitationRow } from '../../mappers/invitations/invitation.mapper.js';
import { toSeatCount } from '../../mappers/members/seat-count.mapper.js';
import { toPage } from '../../mappers/pagination/page.mapper.js';
import { directoryUsers } from '../../schemas/directory/directory-user.schema.js';
import { invitations } from '../../schemas/invitations/invitation.schema.js';
import { organizations } from '../../schemas/organizations/organization.schema.js';

/**
 * Constant INVITER_NAME
 *
 * @description
 * Name of the sender of an invitation, from the user directory; its address stands in for a name
 * not applied yet, and « Ancien membre » for an account identity-service deleted, whose pending
 * invitations stay.
 *
 * @type {SQL<string>}
 */
const INVITER_NAME: SQL<string> = sql<string>`case when ${directoryUsers.deleted} then ${FORMER_MEMBER_NAME}::text else coalesce(${directoryUsers.name}, ${directoryUsers.email}, '') end`;

/**
 * Interface PendingRow
 *
 * @description
 * A row of the pending list.
 */
interface PendingRow {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id of the invitation.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property email
   *
   * @description
   * Invited address.
   *
   * @type {string}
   * @readonly
   */
  readonly email: string;

  /**
   * Property role
   *
   * @description
   * Proposed role.
   *
   * @type {AssignableRole}
   * @readonly
   */
  readonly role: AssignableRole;

  /**
   * Property invitedByUserId
   *
   * @description
   * The sender.
   *
   * @type {string}
   * @readonly
   */
  readonly invitedByUserId: string;

  /**
   * Property inviterName
   *
   * @description
   * Name of the sender.
   *
   * @type {string}
   * @readonly
   */
  readonly inviterName: string;

  /**
   * Property sentAt
   *
   * @description
   * When it was last sent.
   *
   * @type {Date}
   * @readonly
   */
  readonly sentAt: Date;

  /**
   * Property expiresAt
   *
   * @description
   * When it expires.
   *
   * @type {Date}
   * @readonly
   */
  readonly expiresAt: Date;

  /**
   * Property version
   *
   * @description
   * Version of the invitation.
   *
   * @type {number}
   * @readonly
   */
  readonly version: number;
  // #endregion
}

/**
 * Interface ReceivedRow
 *
 * @description
 * A row of the invitations addressed to an account.
 */
interface ReceivedRow extends PendingRow {
  // #region Properties
  /**
   * Property organizationId
   *
   * @description
   * The organization that invites.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationId: string;

  /**
   * Property organizationName
   *
   * @description
   * Its name.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationName: string;

  /**
   * Property organizationSlug
   *
   * @description
   * Its address.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationSlug: string;

  /**
   * Property organizationDescription
   *
   * @description
   * Its description, or `null`.
   *
   * @type {string | null}
   * @readonly
   */
  readonly organizationDescription: string | null;

  /**
   * Property memberCount
   *
   * @description
   * Its members that take a seat.
   *
   * @type {number}
   * @readonly
   */
  readonly memberCount: number;
  // #endregion
}

/**
 * Function positionOf
 *
 * @description
 * The position of an invitation in a list sorted by last sending, the most recent first.
 *
 * @param {PendingRow} row - The row.
 * @returns {PagePosition} Its sending instant, in ISO 8601, and its id.
 */
function positionOf(row: PendingRow): PagePosition {
  return { key: row.sentAt.toISOString(), id: row.id };
}

/**
 * Function before
 *
 * @description
 * The condition of the invitations after a position in a list sorted by last sending, the most
 * recent first.
 *
 * @param {PagePosition | null} after - Where the previous page ended, or `null`.
 * @returns {SQL | undefined} The condition, or none for the first page.
 */
function before(after: PagePosition | null): SQL | undefined {
  return after === null
    ? undefined
    : sql`(${invitations.sentAt}, ${invitations.id}) < (${after.key}::timestamptz, ${after.id}::uuid)`;
}

/**
 * Class DrizzleInvitationRepository
 *
 * @description
 * `InvitationRepository` on `invitations`, joined with `organizations` and `directory_users` for
 * the lists, in the transaction of its unit of work. Every query filters on its organization,
 * except `find` and `listReceived`, which name the invitation or the address and run in a system
 * transaction only.
 */
export class DrizzleInvitationRepository implements InvitationRepository {
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
   * Method insertPending
   *
   * @description
   * Inserts a pending invitation unless the partial unique index finds one for the address.
   *
   * @param {InvitationDraft} draft - The invitation to store.
   * @returns {Promise<Invitation | null>} The stored invitation, or `null`.
   */
  public async insertPending(draft: InvitationDraft): Promise<Invitation | null> {
    const rows: InvitationRow[] = await this.db
      .insert(invitations)
      .values(draft)
      .onConflictDoNothing()
      .returning();
    const row: InvitationRow | undefined = rows[0];
    return row === undefined ? null : toInvitation(row);
  }

  /**
   * Method findPendingTo
   *
   * @description
   * Loads the pending invitation of an address.
   *
   * @param {string} organizationId - The organization.
   * @param {EmailAddress} email - The address.
   * @returns {Promise<Invitation | null>} The invitation, or `null`.
   */
  public async findPendingTo(
    organizationId: string,
    email: EmailAddress,
  ): Promise<Invitation | null> {
    const rows: InvitationRow[] = await this.db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.organizationId, organizationId),
          eq(invitations.email, email.value),
          eq(invitations.status, 'pending'),
        ),
      )
      .limit(1);
    const row: InvitationRow | undefined = rows[0];
    return row === undefined ? null : toInvitation(row);
  }

  /**
   * Method findForUpdate
   *
   * @description
   * Loads and locks an invitation of an organization.
   *
   * @param {string} organizationId - The organization.
   * @param {string} invitationId - Id of the invitation.
   * @returns {Promise<Invitation | null>} The invitation, or `null`.
   */
  public async findForUpdate(
    organizationId: string,
    invitationId: string,
  ): Promise<Invitation | null> {
    const rows: InvitationRow[] = await this.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.organizationId, organizationId), eq(invitations.id, invitationId)))
      .limit(1)
      .for('update');
    const row: InvitationRow | undefined = rows[0];
    return row === undefined ? null : toInvitation(row);
  }

  /**
   * Method findWithInviter
   *
   * @description
   * Loads an invitation of an organization in any state, with the name of its sender.
   *
   * @param {string} organizationId - The organization.
   * @param {string} invitationId - Id of the invitation.
   * @returns {Promise<InvitationWithInviter | null>} The invitation, or `null`.
   */
  public async findWithInviter(
    organizationId: string,
    invitationId: string,
  ): Promise<InvitationWithInviter | null> {
    const rows: { readonly invitation: InvitationRow; readonly inviterName: string }[] =
      await this.db
        .select({ invitation: invitations, inviterName: INVITER_NAME })
        .from(invitations)
        .leftJoin(directoryUsers, eq(directoryUsers.userId, invitations.invitedByUserId))
        .where(
          and(eq(invitations.organizationId, organizationId), eq(invitations.id, invitationId)),
        )
        .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : {
          invitation: toInvitation(row.invitation),
          invitedBy: { userId: row.invitation.invitedByUserId, name: row.inviterName },
        };
  }

  /**
   * Method find
   *
   * @description
   * Loads an invitation by its id alone; in a system transaction only.
   *
   * @param {string} invitationId - Id of the invitation.
   * @returns {Promise<Invitation | null>} The invitation, or `null`.
   */
  public async find(invitationId: string): Promise<Invitation | null> {
    const rows: InvitationRow[] = await this.db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);
    const row: InvitationRow | undefined = rows[0];
    return row === undefined ? null : toInvitation(row);
  }

  /**
   * Method update
   *
   * @description
   * Writes the state of a locked invitation, from the previous version only.
   *
   * @param {Invitation} invitation - The invitation after the change.
   * @returns {Promise<void>} Resolves once written.
   * @throws {Error} When no row has the previous version.
   */
  public async update(invitation: Invitation): Promise<void> {
    const state: InvitationState = invitation.snapshot;
    const updated: { id: string }[] = await this.db
      .update(invitations)
      .set({
        status: state.status,
        sentAt: state.sentAt,
        expiresAt: state.expiresAt,
        answeredAt: state.answeredAt,
        version: state.version,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(invitations.organizationId, state.organizationId),
          eq(invitations.id, state.id),
          eq(invitations.version, state.version - 1),
        ),
      )
      .returning({ id: invitations.id });
    if (updated.length !== 1) {
      throw new Error('The invitation changed since it was loaded.');
    }
  }

  /**
   * Method listPending
   *
   * @description
   * One page of the pending invitations of an organization, the most recently sent first.
   *
   * @param {string} organizationId - The organization.
   * @param {Date} now - The instant that tells `pending` from `expired`.
   * @param {PagePosition | null} after - Where the previous page ended, or `null`.
   * @param {number} limit - Page size.
   * @returns {Promise<Page<InvitationView>>} The page.
   */
  public async listPending(
    organizationId: string,
    now: Date,
    after: PagePosition | null,
    limit: number,
  ): Promise<Page<InvitationView>> {
    const rows: PendingRow[] = await this.db
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        invitedByUserId: invitations.invitedByUserId,
        inviterName: INVITER_NAME,
        sentAt: invitations.sentAt,
        expiresAt: invitations.expiresAt,
        version: invitations.version,
      })
      .from(invitations)
      .leftJoin(directoryUsers, eq(directoryUsers.userId, invitations.invitedByUserId))
      .where(
        and(
          eq(invitations.organizationId, organizationId),
          eq(invitations.status, 'pending'),
          before(after),
        ),
      )
      .orderBy(desc(invitations.sentAt), desc(invitations.id))
      .limit(limit + 1);
    return toPage(
      rows,
      limit,
      (row: PendingRow): InvitationView => ({
        id: row.id,
        email: row.email,
        role: row.role,
        invitedBy: { userId: row.invitedByUserId, name: row.inviterName },
        status: Invitation.pendingStatusAt(row.expiresAt, now),
        sentAt: row.sentAt,
        expiresAt: row.expiresAt,
        version: row.version,
      }),
      positionOf,
    );
  }

  /**
   * Method countPending
   *
   * @description
   * Counts the pending invitations of an organization.
   *
   * @param {string} organizationId - The organization.
   * @returns {Promise<number>} The count.
   */
  public async countPending(organizationId: string): Promise<number> {
    const rows: { count: number }[] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(invitations)
      .where(
        and(eq(invitations.organizationId, organizationId), eq(invitations.status, 'pending')),
      );
    return rows[0]?.count ?? 0;
  }

  /**
   * Method listReceived
   *
   * @description
   * One page of the pending invitations, not expired, sent to an address by any organization, the
   * most recently sent first; in a system transaction only.
   *
   * @param {EmailAddress} email - The verified address of the invitee.
   * @param {Date} now - The instant before which they expire.
   * @param {PagePosition | null} after - Where the previous page ended, or `null`.
   * @param {number} limit - Page size.
   * @returns {Promise<Page<ReceivedInvitationView>>} The page.
   */
  public async listReceived(
    email: EmailAddress,
    now: Date,
    after: PagePosition | null,
    limit: number,
  ): Promise<Page<ReceivedInvitationView>> {
    const rows: ReceivedRow[] = await this.db
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        invitedByUserId: invitations.invitedByUserId,
        inviterName: INVITER_NAME,
        sentAt: invitations.sentAt,
        expiresAt: invitations.expiresAt,
        version: invitations.version,
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
        organizationDescription: organizations.description,
        memberCount: toSeatCount(this.db, organizations.id),
      })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .leftJoin(directoryUsers, eq(directoryUsers.userId, invitations.invitedByUserId))
      .where(
        and(
          eq(invitations.email, email.value),
          eq(invitations.status, 'pending'),
          gt(invitations.expiresAt, now),
          before(after),
        ),
      )
      .orderBy(desc(invitations.sentAt), desc(invitations.id))
      .limit(limit + 1);
    return toPage(
      rows,
      limit,
      (row: ReceivedRow): ReceivedInvitationView => ({
        id: row.id,
        organization: {
          id: row.organizationId,
          name: row.organizationName,
          slug: row.organizationSlug,
          description: row.organizationDescription,
          memberCount: row.memberCount,
        },
        role: row.role,
        invitedBy: { userId: row.invitedByUserId, name: row.inviterName },
        expiresAt: row.expiresAt,
      }),
      positionOf,
    );
  }
  // #endregion
}
