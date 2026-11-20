import { createHash } from 'node:crypto';

import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';

import { OrganizationLogo } from '../../../../../domain/aggregates/logo/organization-logo.aggregate.js';
import { OrganizationLogoReservation } from '../../../../../domain/aggregates/logo/organization-logo-reservation.aggregate.js';
import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import { toMember } from '../../mappers/members/member.mapper.js';
import { organizationLogoReservations } from '../../schemas/logo/organization-logo-reservation.schema.js';
import { members } from '../../schemas/members/member.schema.js';
import { organizations } from '../../schemas/organizations/organization.schema.js';

type ReservationRow = typeof organizationLogoReservations.$inferSelect;

function toReservation(row: ReservationRow): OrganizationLogoReservation {
  return OrganizationLogoReservation.restore({
    organizationId: row.organizationId,
    uploaderUserId: row.uploaderUserId,
    uploadId: row.uploadId,
    generation: row.generation,
    declaration: { contentType: row.contentType, sizeBytes: row.sizeBytes },
    expiresAt: row.expiresAt,
    state: row.state,
  });
}

function keyDigest(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Reads and writes only the organization bound to this transaction. */
export class DrizzleOrganizationLogoRepository {
  // #region Properties
  /** Optimistic guard from the row locked by this instance in its current transaction. */
  private locked: { readonly version: number; readonly generation: number } | undefined;
  // #endregion

  // #region Constructor
  /** Binds the repository to the tenant transaction and its verified organization. */
  public constructor(
    private readonly db: TransactionDatabase,
    private readonly organizationId: string,
  ) {}
  // #endregion

  // #region Methods
  /** Locks the current active membership before the organization. */
  public async lockMember(organizationId: string, userId: string): Promise<Member | null> {
    this.requireTenant(organizationId);
    const rows = await this.db
      .select()
      .from(members)
      .where(
        and(
          eq(members.organizationId, this.organizationId),
          eq(members.userId, userId),
          isNull(members.removedAt),
        ),
      )
      .limit(1)
      .for('update');
    return rows[0] === undefined ? null : toMember(rows[0]);
  }

  /** Locks the owner row and records the prior version and image generation. */
  public async lockLogo(organizationId: string): Promise<OrganizationLogo | null> {
    this.requireTenant(organizationId);
    const rows = await this.db
      .select({
        organizationId: organizations.id,
        assetId: organizations.logoId,
        generation: organizations.logoGeneration,
        profileVersion: organizations.version,
      })
      .from(organizations)
      .where(eq(organizations.id, this.organizationId))
      .limit(1)
      .for('update');
    const row = rows[0];
    if (row === undefined) return null;
    this.locked = { version: row.profileVersion, generation: row.generation };
    return OrganizationLogo.restore(row);
  }

  /** Finds the actor's still-live replay claim under the locked organization. */
  public async findByKey(
    organizationId: string,
    userId: string,
    key: string,
  ): Promise<OrganizationLogoReservation | null> {
    this.requireTenant(organizationId);
    const rows = await this.db
      .select()
      .from(organizationLogoReservations)
      .where(
        and(
          eq(organizationLogoReservations.organizationId, this.organizationId),
          eq(organizationLogoReservations.uploaderUserId, userId),
          eq(organizationLogoReservations.requestKeyDigest, keyDigest(key)),
          gt(organizationLogoReservations.requestKeyExpiresAt, sql`clock_timestamp()`),
        ),
      )
      .limit(1);
    return rows[0] === undefined ? null : toReservation(rows[0]);
  }

  /** Locks one exact actor-owned upload after the organization lock. */
  public async lockReservation(
    organizationId: string,
    userId: string,
    uploadId: string,
  ): Promise<OrganizationLogoReservation | null> {
    this.requireTenant(organizationId);
    const rows = await this.db
      .select()
      .from(organizationLogoReservations)
      .where(
        and(
          eq(organizationLogoReservations.organizationId, this.organizationId),
          eq(organizationLogoReservations.uploaderUserId, userId),
          eq(organizationLogoReservations.uploadId, uploadId),
        ),
      )
      .limit(1)
      .for('update');
    return rows[0] === undefined ? null : toReservation(rows[0]);
  }

  /** Allocates an identifier using the database's UUID v7 implementation. */
  public async newUploadId(): Promise<string> {
    const result = await this.db.execute<{ id: string }>(sql`select uuidv7() as id`);
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error('The database did not allocate a logo upload ID.');
    return id;
  }

  /** Writes the allocation and, when supplied, its 24-hour actor-scoped claim. */
  public async insertReservation(
    reservation: OrganizationLogoReservation,
    key: string | undefined,
  ): Promise<void> {
    const state = reservation.snapshot;
    this.requireTenant(state.organizationId);
    const digest = key === undefined ? null : keyDigest(key);
    if (digest !== null) {
      await this.db
        .update(organizationLogoReservations)
        .set({ requestKeyDigest: null, requestKeyExpiresAt: null })
        .where(
          and(
            eq(organizationLogoReservations.organizationId, this.organizationId),
            eq(organizationLogoReservations.uploaderUserId, state.uploaderUserId),
            eq(organizationLogoReservations.requestKeyDigest, digest),
            lte(organizationLogoReservations.requestKeyExpiresAt, sql`clock_timestamp()`),
          ),
        );
    }
    await this.db.insert(organizationLogoReservations).values({
      organizationId: this.organizationId,
      uploaderUserId: state.uploaderUserId,
      uploadId: state.uploadId,
      generation: state.generation,
      contentType: state.declaration.contentType,
      sizeBytes: state.declaration.sizeBytes,
      state: state.state,
      expiresAt: state.expiresAt,
      requestKeyDigest: digest,
      requestKeyExpiresAt: digest === null ? null : sql`clock_timestamp() + interval '24 hours'`,
    });
  }

  /** Persists a terminal state under the already locked actor and upload identity. */
  public async saveReservation(reservation: OrganizationLogoReservation): Promise<void> {
    const state = reservation.snapshot;
    this.requireTenant(state.organizationId);
    const rows = await this.db
      .update(organizationLogoReservations)
      .set({ state: state.state, updatedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(organizationLogoReservations.organizationId, this.organizationId),
          eq(organizationLogoReservations.uploaderUserId, state.uploaderUserId),
          eq(organizationLogoReservations.uploadId, state.uploadId),
          eq(organizationLogoReservations.state, 'pending'),
        ),
      )
      .returning({ uploadId: organizationLogoReservations.uploadId });
    if (rows.length !== 1) throw new Error('The locked logo reservation changed.');
  }

  /** Saves both owner versions, including a private generation-only deletion. */
  public async saveLogo(logo: OrganizationLogo): Promise<void> {
    const state = logo.snapshot;
    this.requireTenant(state.organizationId);
    const previous = this.locked;
    if (previous === undefined) throw new Error('The organization logo has not been locked.');
    const rows = await this.db
      .update(organizations)
      .set({
        logoId: state.assetId,
        logoGeneration: state.generation,
        version: state.profileVersion,
        updatedAt: sql`case when ${organizations.version} <> ${state.profileVersion} then clock_timestamp() else ${organizations.updatedAt} end`,
      })
      .where(
        and(
          eq(organizations.id, this.organizationId),
          eq(organizations.version, previous.version),
          eq(organizations.logoGeneration, previous.generation),
        ),
      )
      .returning({ id: organizations.id });
    if (rows.length !== 1) throw new Error('The locked organization logo changed.');
    this.locked = { version: state.profileVersion, generation: state.generation };
  }

  /** Refuses a caller or aggregate from a different tenant. */
  private requireTenant(organizationId: string): void {
    if (organizationId.toLowerCase() !== this.organizationId.toLowerCase()) {
      throw new Error('The logo organization does not match the transaction.');
    }
  }
  // #endregion
}
