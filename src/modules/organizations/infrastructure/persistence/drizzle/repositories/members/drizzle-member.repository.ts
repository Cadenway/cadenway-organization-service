import { requireOrganizationId } from '@cadenway/nest-common';
import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, asc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { MemberFilters } from '../../../../../application/models/members/member-filters.model.js';
import type { Page } from '../../../../../application/models/pagination/page.model.js';
import type { PagePosition } from '../../../../../application/models/pagination/page-position.model.js';
import type { MemberRepository } from '../../../../../application/ports/outbound/persistence/members/member-repository.port.js';
import type { MemberView } from '../../../../../application/projections/members/member-view.projection.js';
import type { RoleCounts } from '../../../../../application/projections/members/role-counts.projection.js';
import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import { SEAT_ROLES } from '../../../../../domain/policies/members/seat.policy.js';
import type { EmailAddress } from '../../../../../domain/value-objects/email/email-address.value-object.js';
import type { MemberDraft } from '../../../../../domain/value-objects/members/member-draft.value-object.js';
import type { MemberState } from '../../../../../domain/value-objects/members/member-state.value-object.js';
import type { Role } from '../../../../../domain/value-objects/members/role.value-object.js';
import { toMember } from '../../mappers/members/member.mapper.js';
import type { MemberRow } from '../../mappers/members/member.mapper.js';
import { toPage } from '../../mappers/pagination/page.mapper.js';
import { directoryUsers } from '../../schemas/directory/directory-user.schema.js';
import { members } from '../../schemas/members/member.schema.js';

/**
 * Interface MemberListRow
 *
 * @description
 * A row of the member list: the membership, the name, address and two-step verification of its
 * account, and its sort key.
 */
interface MemberListRow extends MemberView {
  // #region Properties
  /**
   * Property sortKey
   *
   * @description
   * Search key of the name, the sort key of the list.
   *
   * @type {string}
   * @readonly
   */
  readonly sortKey: string;
  // #endregion
}

/**
 * Constant SORT_KEY
 *
 * @description
 * Sort key of a member: the search key of its name. A member always has a directory entry (the
 * owner needed one to create the organization, an invitee a verified address to accept), and its
 * address stands in for a name not applied yet.
 *
 * @type {SQL<string>}
 */
const SORT_KEY: SQL<string> = sql<string>`coalesce(${directoryUsers.nameKey}, ${directoryUsers.email}, '')`;

/**
 * Constant MEMBER_COLUMNS
 *
 * @description
 * The columns of a member view, with its sort key.
 *
 * @type {object}
 */
const MEMBER_COLUMNS: {
  readonly id: typeof members.id;
  readonly userId: typeof members.userId;
  readonly name: SQL<string>;
  readonly email: SQL<string>;
  readonly role: typeof members.role;
  readonly joinedAt: typeof members.joinedAt;
  readonly version: typeof members.version;
  readonly twoStepVerificationEnabled: SQL<boolean>;
  readonly sortKey: SQL<string>;
} = {
  id: members.id,
  userId: members.userId,
  name: sql<string>`coalesce(${directoryUsers.name}, ${directoryUsers.email}, '')`,
  email: sql<string>`coalesce(${directoryUsers.email}, '')`,
  role: members.role,
  joinedAt: members.joinedAt,
  version: members.version,
  twoStepVerificationEnabled: sql<boolean>`coalesce(${directoryUsers.twoStepVerificationEnabled}, false)`,
  sortKey: SORT_KEY,
};

/**
 * Function containsPattern
 *
 * @description
 * A `LIKE` pattern that finds a search key anywhere, with the wildcards and the escape character
 * of the key escaped, so the text of the search is matched literally.
 *
 * @param {string} key - The search key.
 * @returns {string} The pattern.
 */
function containsPattern(key: string): string {
  return `%${key.replace(/[\\%_]/gu, '\\$&')}%`;
}

/**
 * Function toMemberView
 *
 * @description
 * A member view without its sort key.
 *
 * @param {MemberListRow} row - The row.
 * @returns {MemberView} The view.
 */
function toMemberView(row: MemberListRow): MemberView {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
    joinedAt: row.joinedAt,
    version: row.version,
    twoStepVerificationEnabled: row.twoStepVerificationEnabled,
  };
}

/**
 * Class DrizzleMemberRepository
 *
 * @description
 * `MemberRepository` on `members`, joined with `directory_users` for the names and addresses, in
 * the transaction of its unit of work. Every query filters on its organization explicitly, under
 * the row-level security of a tenant transaction.
 */
export class DrizzleMemberRepository implements MemberRepository {
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
   * Method insert
   *
   * @description
   * Inserts a new membership and reads back the id PostgreSQL assigned.
   *
   * @param {MemberDraft} draft - The membership to store.
   * @returns {Promise<Member>} The stored membership.
   */
  public async insert(draft: MemberDraft): Promise<Member> {
    const rows: MemberRow[] = await this.db.insert(members).values(draft).returning();
    const row: MemberRow | undefined = rows[0];
    if (row === undefined) {
      throw new Error('The insert of a membership returned no row.');
    }
    return toMember(row);
  }

  /**
   * Method findActiveOfUser
   *
   * @description
   * Loads the active membership of an account.
   *
   * @param {string} organizationId - The organization.
   * @param {string} userId - The account.
   * @returns {Promise<Member | null>} The membership, or `null`.
   */
  public async findActiveOfUser(organizationId: string, userId: string): Promise<Member | null> {
    const rows: MemberRow[] = await this.db
      .select()
      .from(members)
      .where(
        and(
          eq(members.organizationId, organizationId),
          eq(members.userId, userId),
          isNull(members.removedAt),
        ),
      )
      .limit(1);
    const row: MemberRow | undefined = rows[0];
    return row === undefined ? null : toMember(row);
  }

  /** Locks the active actor and target rows in a stable order before permission is evaluated. */
  public async lockActorAndTarget(
    organizationId: string,
    actorUserId: string,
    memberId: string,
  ): Promise<readonly Member[]> {
    const rows: MemberRow[] = await this.db
      .select()
      .from(members)
      .where(
        and(
          eq(members.organizationId, organizationId),
          isNull(members.removedAt),
          or(eq(members.userId, actorUserId), eq(members.id, memberId)),
        ),
      )
      .orderBy(asc(members.id))
      .for('update');
    return rows.map(toMember);
  }

  /**
   * Method findActiveOfAccountForUpdate
   *
   * @description
   * Loads and locks the active memberships of an account in every organization, by organization
   * then id, so two transactions lock them in the same order. A system query filtered on the
   * account, served by `members_user_active_index`.
   *
   * @param {string} userId - The account.
   * @returns {Promise<readonly Member[]>} The memberships.
   */
  public async findActiveOfAccountForUpdate(userId: string): Promise<readonly Member[]> {
    const rows: MemberRow[] = await this.db
      .select()
      .from(members)
      .where(and(eq(members.userId, userId), isNull(members.removedAt)))
      .orderBy(asc(members.organizationId), asc(members.id))
      .for('update');
    return rows.map(toMember);
  }

  /** Loads only active owner rows for the account, under the caller's directory row lock. */
  public async listOwnedOrganizationIds(userId: string): Promise<readonly string[]> {
    const rows = await this.db
      .select({ organizationId: members.organizationId })
      .from(members)
      .where(and(eq(members.userId, userId), eq(members.role, 'owner'), isNull(members.removedAt)))
      .orderBy(asc(members.organizationId));
    return rows.map(({ organizationId }) => organizationId);
  }

  /**
   * Method update
   *
   * @description
   * Writes the role, the removal and the version of a locked membership, from the previous version
   * only.
   *
   * @param {Member} member - The membership after the change.
   * @returns {Promise<void>} Resolves once written.
   * @throws {Error} When no row has the previous version.
   */
  public async update(member: Member): Promise<void> {
    const state: MemberState = member.snapshot;
    const updated: { id: string }[] = await this.db
      .update(members)
      .set({
        role: state.role,
        removedAt: state.removedAt,
        version: state.version,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(members.organizationId, state.organizationId),
          eq(members.id, state.id),
          eq(members.version, state.version - 1),
        ),
      )
      .returning({ id: members.id });
    if (updated.length !== 1) {
      throw new Error('The membership changed since it was loaded.');
    }
  }

  /**
   * Method hasActiveMemberWithEmail
   *
   * @description
   * Whether an active member has this address, verified, in the user directory.
   *
   * @param {string} organizationId - The organization.
   * @param {EmailAddress} email - The address.
   * @returns {Promise<boolean>} Whether it is the address of a member.
   */
  public async hasActiveMemberWithEmail(
    organizationId: string,
    email: EmailAddress,
  ): Promise<boolean> {
    const rows: { id: string }[] = await this.db
      .select({ id: members.id })
      .from(members)
      .innerJoin(directoryUsers, eq(directoryUsers.userId, members.userId))
      .where(
        and(
          eq(members.organizationId, organizationId),
          isNull(members.removedAt),
          eq(directoryUsers.email, email.value),
          eq(directoryUsers.emailVerified, true),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Method lockSeatAdmission
   *
   * @description
   * Serializes seat increases in one tenant until the transaction ends. The caller counts seats
   * in a later statement so READ COMMITTED observes an earlier lock holder's committed changes.
   *
   * @param {string} organizationId - The organization in the current tenant context.
   * @returns {Promise<void>} Resolves after acquiring the transaction-scoped lock.
   */
  public async lockSeatAdmission(organizationId: string): Promise<void> {
    if (requireOrganizationId() !== organizationId) {
      throw new Error('Seat admission organization does not match the current tenant.');
    }
    await this.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('organization-seat-admission:' || ${organizationId}::uuid::text, 0))`,
    );
  }

  /**
   * Method countSeats
   *
   * @description
   * Counts the active members that take a seat.
   *
   * @param {string} organizationId - The organization.
   * @returns {Promise<number>} The count.
   */
  public async countSeats(organizationId: string): Promise<number> {
    const rows: { count: number }[] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(members)
      .where(
        and(
          eq(members.organizationId, organizationId),
          isNull(members.removedAt),
          inArray(members.role, [...SEAT_ROLES]),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  /**
   * Method countByRole
   *
   * @description
   * Counts the active members by role.
   *
   * @param {string} organizationId - The organization.
   * @returns {Promise<RoleCounts>} The counts, 0 for a role without member.
   */
  public async countByRole(organizationId: string): Promise<RoleCounts> {
    const rows: { role: Role; count: number }[] = await this.db
      .select({ role: members.role, count: sql<number>`count(*)::int` })
      .from(members)
      .where(and(eq(members.organizationId, organizationId), isNull(members.removedAt)))
      .groupBy(members.role);
    const countOf = (role: Role): number =>
      rows.find((row: { role: Role; count: number }): boolean => row.role === role)?.count ?? 0;
    return {
      owner: countOf('owner'),
      admin: countOf('admin'),
      member: countOf('member'),
      guest: countOf('guest'),
    };
  }

  /**
   * Method view
   *
   * @description
   * Reads an active member with the name, address and two-step verification of its account.
   *
   * @param {string} organizationId - The organization.
   * @param {string} memberId - Id of the membership.
   * @returns {Promise<MemberView | null>} The member, or `null`.
   */
  public async view(organizationId: string, memberId: string): Promise<MemberView | null> {
    const rows: MemberListRow[] = await this.db
      .select(MEMBER_COLUMNS)
      .from(members)
      .leftJoin(directoryUsers, eq(directoryUsers.userId, members.userId))
      .where(
        and(
          eq(members.organizationId, organizationId),
          eq(members.id, memberId),
          isNull(members.removedAt),
        ),
      )
      .limit(1);
    const row: MemberListRow | undefined = rows[0];
    return row === undefined ? null : toMemberView(row);
  }

  /**
   * Method list
   *
   * @description
   * One page of the active members that match the filters, by sort key, then by id.
   *
   * @param {string} organizationId - The organization.
   * @param {MemberFilters} filters - The search and the roles.
   * @param {PagePosition | null} after - Where the previous page ended, or `null`.
   * @param {number} limit - Page size.
   * @returns {Promise<Page<MemberView>>} The page.
   */
  public async list(
    organizationId: string,
    filters: MemberFilters,
    after: PagePosition | null,
    limit: number,
  ): Promise<Page<MemberView>> {
    const rows: MemberListRow[] = await this.db
      .select(MEMBER_COLUMNS)
      .from(members)
      .leftJoin(directoryUsers, eq(directoryUsers.userId, members.userId))
      .where(
        and(
          this.matching(organizationId, filters),
          after === null
            ? undefined
            : sql`(${SORT_KEY}, ${members.id}) > (${after.key}, ${after.id}::uuid)`,
        ),
      )
      .orderBy(asc(SORT_KEY), asc(members.id))
      .limit(limit + 1);
    return toPage(rows, limit, toMemberView, (row: MemberListRow): PagePosition => ({
      key: row.sortKey,
      id: row.id,
    }));
  }

  /**
   * Method count
   *
   * @description
   * Counts the active members that match the filters.
   *
   * @param {string} organizationId - The organization.
   * @param {MemberFilters} filters - The search and the roles.
   * @returns {Promise<number>} The count.
   */
  public async count(organizationId: string, filters: MemberFilters): Promise<number> {
    const rows: { count: number }[] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(members)
      .leftJoin(directoryUsers, eq(directoryUsers.userId, members.userId))
      .where(this.matching(organizationId, filters));
    return rows[0]?.count ?? 0;
  }

  /**
   * Method matching
   *
   * @description
   * The condition of the active members of an organization that match the filters: a role among
   * those kept, a search key found in the search key of the name or in the address.
   *
   * @param {string} organizationId - The organization.
   * @param {MemberFilters} filters - The search and the roles.
   * @returns {SQL | undefined} The condition.
   */
  private matching(organizationId: string, filters: MemberFilters): SQL | undefined {
    const pattern: string | null = filters.search === null ? null : containsPattern(filters.search);
    return and(
      eq(members.organizationId, organizationId),
      isNull(members.removedAt),
      filters.roles === null ? undefined : inArray(members.role, [...filters.roles]),
      pattern === null
        ? undefined
        : or(like(directoryUsers.nameKey, pattern), like(directoryUsers.email, pattern)),
    );
  }
  // #endregion
}
