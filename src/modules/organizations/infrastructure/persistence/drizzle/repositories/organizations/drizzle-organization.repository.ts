import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Page } from '../../../../../application/models/pagination/page.model.js';
import type { PagePosition } from '../../../../../application/models/pagination/page-position.model.js';
import type { OrganizationRepository } from '../../../../../application/ports/outbound/persistence/organizations/organization-repository.port.js';
import type { MyOrganizationView } from '../../../../../application/projections/organizations/my-organization-view.projection.js';
import type { Organization } from '../../../../../domain/aggregates/organization/organization.aggregate.js';
import { SlugTakenError } from '../../../../../domain/errors/organizations/slug-taken.error.js';
import { FREE_SEAT_ENTITLEMENT } from '../../../../../domain/value-objects/billing/seat-entitlement.value-object.js';
import type { Role } from '../../../../../domain/value-objects/members/role.value-object.js';
import type { OrganizationDraft } from '../../../../../domain/value-objects/organizations/organization-draft.value-object.js';
import type { OrganizationState } from '../../../../../domain/value-objects/organizations/organization-state.value-object.js';
import { searchKeyOf } from '../../../../../domain/value-objects/search/search-key.value-object.js';
import { toSeatCount } from '../../mappers/members/seat-count.mapper.js';
import { toOrganization } from '../../mappers/organizations/organization.mapper.js';
import type { OrganizationRow } from '../../mappers/organizations/organization.mapper.js';
import { toPage } from '../../mappers/pagination/page.mapper.js';
import { violatedUniqueConstraint } from '../../mappers/postgres/unique-violation.mapper.js';
import { organizationSeatEntitlements } from '../../schemas/billing/organization-seat-entitlement.schema.js';
import { members } from '../../schemas/members/member.schema.js';
import { organizations } from '../../schemas/organizations/organization.schema.js';

/**
 * Constant SLUG_UNIQUE
 *
 * @description
 * The unique index of the addresses.
 *
 * @type {string}
 */
const SLUG_UNIQUE: string = 'organizations_slug_unique';

/**
 * Interface MyOrganizationRow
 *
 * @description
 * A row of the list of the organizations of an account.
 */
interface MyOrganizationRow {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Id of the organization.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property name
   *
   * @description
   * Name.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property nameKey
   *
   * @description
   * Search key of the name, the sort key.
   *
   * @type {string}
   * @readonly
   */
  readonly nameKey: string;

  /**
   * Property slug
   *
   * @description
   * Address.
   *
   * @type {string}
   * @readonly
   */
  readonly slug: string;

  /**
   * Property plan
   *
   * @description
   * Plan.
   *
   * @type {string}
   * @readonly
   */
  readonly plan: string;

  /**
   * Property role
   *
   * @description
   * Role of the account.
   *
   * @type {Role}
   * @readonly
   */
  readonly role: Role;

  /**
   * Property joinedAt
   *
   * @description
   * When the account joined.
   *
   * @type {Date}
   * @readonly
   */
  readonly joinedAt: Date;

  /**
   * Property memberCount
   *
   * @description
   * Members that take a seat.
   *
   * @type {number}
   * @readonly
   */
  readonly memberCount: number;
  // #endregion
}

/**
 * Function slugConflictOf
 *
 * @description
 * The refusal of a statement that violated the unique index of the addresses, or the error itself.
 *
 * @param {unknown} error - What the statement threw.
 * @param {string} slug - The address written.
 * @returns {unknown} `SlugTakenError`, or the error.
 */
function slugConflictOf(error: unknown, slug: string): unknown {
  return violatedUniqueConstraint(error) === SLUG_UNIQUE ? new SlugTakenError(slug) : error;
}

/**
 * Class DrizzleOrganizationRepository
 *
 * @description
 * `OrganizationRepository` on `organizations`, in the transaction of its unit of work. Every read
 * names its organization or, for the list of an account, its account through `members`.
 */
export class DrizzleOrganizationRepository implements OrganizationRepository {
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
   * Inserts a new organization and reads back the id PostgreSQL assigned.
   *
   * @param {OrganizationDraft} draft - The organization to store.
   * @returns {Promise<Organization>} The stored organization.
   * @throws {SlugTakenError} When another organization uses its address.
   */
  public async insert(draft: OrganizationDraft): Promise<Organization> {
    let rows: OrganizationRow[];
    try {
      rows = await this.db
        .insert(organizations)
        .values({ ...draft, nameKey: searchKeyOf(draft.name) })
        .returning();
    } catch (error) {
      throw slugConflictOf(error, draft.slug);
    }
    const row: OrganizationRow | undefined = rows[0];
    if (row === undefined) {
      throw new Error('The insert of an organization returned no row.');
    }
    return toOrganization(row);
  }

  /**
   * Method find
   *
   * @description
   * Loads an organization.
   *
   * @param {string} organizationId - Id of the organization.
   * @returns {Promise<Organization | null>} The organization, or `null`.
   */
  public async find(organizationId: string): Promise<Organization | null> {
    const rows: OrganizationRow[] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const row: OrganizationRow | undefined = rows[0];
    return row === undefined ? null : toOrganization(row);
  }

  /**
   * Method findForUpdate
   *
   * @description
   * Loads and locks an organization.
   *
   * @param {string} organizationId - Id of the organization.
   * @returns {Promise<Organization | null>} The organization, or `null`.
   */
  public async findForUpdate(organizationId: string): Promise<Organization | null> {
    const rows: OrganizationRow[] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1)
      .for('update');
    const row: OrganizationRow | undefined = rows[0];
    return row === undefined ? null : toOrganization(row);
  }

  /**
   * Method update
   *
   * @description
   * Writes the profile and the version of an organization locked by `findForUpdate`, from the
   * previous version only.
   *
   * @param {Organization} organization - The organization after the change.
   * @returns {Promise<void>} Resolves once written.
   * @throws {SlugTakenError} When another organization uses its new address.
   * @throws {Error} When no row has the previous version.
   */
  public async update(organization: Organization): Promise<void> {
    const state: OrganizationState = organization.snapshot;
    let updated: { id: string }[];
    try {
      updated = await this.db
        .update(organizations)
        .set({
          name: state.name,
          nameKey: searchKeyOf(state.name),
          slug: state.slug,
          description: state.description,
          website: state.website,
          defaultLanguage: state.defaultLanguage,
          version: state.version,
          updatedAt: sql`now()`,
        })
        .where(and(eq(organizations.id, state.id), eq(organizations.version, state.version - 1)))
        .returning({ id: organizations.id });
    } catch (error) {
      throw slugConflictOf(error, state.slug);
    }
    if (updated.length !== 1) {
      throw new Error('The organization changed since it was loaded.');
    }
  }

  /**
   * Method listOfUser
   *
   * @description
   * One page of the organizations an account is an active member of, sorted by the search key of
   * their name, then by id, each with its seat count.
   *
   * @param {string} userId - The account.
   * @param {PagePosition | null} after - Where the previous page ended, or `null`.
   * @param {number} limit - Page size.
   * @returns {Promise<Page<MyOrganizationView>>} The page.
   */
  public async listOfUser(
    userId: string,
    after: PagePosition | null,
    limit: number,
  ): Promise<Page<MyOrganizationView>> {
    const seats: SQL<number> = toSeatCount(this.db, organizations.id);
    const rows: MyOrganizationRow[] = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        nameKey: organizations.nameKey,
        slug: organizations.slug,
        plan: sql<string>`coalesce(${organizationSeatEntitlements.plan}, ${FREE_SEAT_ENTITLEMENT.plan})`,
        role: members.role,
        joinedAt: members.joinedAt,
        memberCount: seats,
      })
      .from(members)
      .innerJoin(organizations, eq(organizations.id, members.organizationId))
      .leftJoin(
        organizationSeatEntitlements,
        eq(organizationSeatEntitlements.organizationId, organizations.id),
      )
      .where(
        and(
          eq(members.userId, userId),
          isNull(members.removedAt),
          after === null
            ? undefined
            : sql`(${organizations.nameKey}, ${organizations.id}) > (${after.key}, ${after.id}::uuid)`,
        ),
      )
      .orderBy(asc(organizations.nameKey), asc(organizations.id))
      .limit(limit + 1);
    return toPage(
      rows,
      limit,
      (row: MyOrganizationRow): MyOrganizationView => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        role: row.role,
        memberCount: row.memberCount,
        plan: row.plan,
        joinedAt: row.joinedAt,
      }),
      (row: MyOrganizationRow): PagePosition => ({ key: row.nameKey, id: row.id }),
    );
  }

  /** Reads the tenant and its billable seats in one database snapshot. */
  public async countActiveSeats(organizationId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ count: toSeatCount(this.db, organizations.id) })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    return row?.count ?? null;
  }
  // #endregion
}
