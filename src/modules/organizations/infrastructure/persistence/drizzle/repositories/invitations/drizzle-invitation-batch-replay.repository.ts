import { createHash } from 'node:crypto';

import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { InvitationBatchReplayKey } from '../../../../../application/models/invitations/invitation-batch-replay-key.model.js';
import type { InvitationBatchReplay } from '../../../../../application/models/invitations/invitation-batch-replay.model.js';
import type { StoredInvitationBatch } from '../../../../../application/models/invitations/stored-invitation-batch.model.js';
import type { InvitationBatchReplayRepository } from '../../../../../application/ports/outbound/persistence/invitations/invitation-batch-replay-repository.port.js';
import {
  INVITATION_BATCH_LEASE_MS,
  INVITATION_BATCH_REPLAY_MS,
} from '../../../../../domain/policies/invitations/invitation-batch-replay.policy.js';
import type { InvitationBatchRequest } from '../../../../../domain/value-objects/invitations/invitation-batch-request.value-object.js';
import { invitationBatchReplays } from '../../schemas/invitations/invitation-batch-replay.schema.js';
import { members } from '../../schemas/members/member.schema.js';

/**
 * Constant INLINE_PURGE_LIMIT
 *
 * @description
 * How many expired records of its organization, other than its own key's, a keyed batch deletes:
 * a small bound, so the batch never holds its allowance locks for a long delete. The
 * `organization.purge-invitation-batch-replays` job removes the rest.
 *
 * @type {number}
 */
const INLINE_PURGE_LIMIT: number = 10;

/**
 * Constant REPLAY_CLOCK
 *
 * @description
 * The clock a replay window is written and read on: the database's, at the moment of the call
 * (`clock_timestamp()`, not the start of the transaction), so neither the clock of a replica nor the
 * time a batch waited on its locks moves the 24 hours. The live read selects one row by its
 * primary key, so the volatility of the function costs no index there.
 *
 * @type {SQL<Date>}
 */
const REPLAY_CLOCK: SQL<Date> = sql<Date>`clock_timestamp()`;

/**
 * Constant PURGE_CUTOFF
 *
 * @description
 * The instant a purge deletes the records expired at: the database's, fixed for the statement
 * (`statement_timestamp()`), so PostgreSQL can range-scan an expiry index with it, which a volatile
 * `clock_timestamp()` prevents. It is never earlier than the clock of a read the same transaction
 * made before, so a record the batch found expired is purged.
 *
 * @type {SQL<Date>}
 */
export const PURGE_CUTOFF: SQL<Date> = sql<Date>`statement_timestamp()`;

/**
 * Function inlinePurgeOf
 *
 * @description
 * The bounded delete a keyed batch runs: at most `INLINE_PURGE_LIMIT` expired records of its
 * organization, oldest first, by `invitation_batch_replays_organization_expiry_index`, skipping the
 * rows another transaction holds, and never the row of the batch's own key.
 *
 * @param {string} organizationId - The organization of the batch.
 * @param {InvitationBatchReplayKey | undefined} spared - The key of the batch, whose row stays.
 * @returns {SQL} The statement.
 */
export function inlinePurgeOf(organizationId: string, spared?: InvitationBatchReplayKey): SQL {
  const own: SQL =
    spared === undefined
      ? sql`true`
      : sql`(actor_user_id, key_digest) <> (${spared.actorUserId}::uuid, ${digestOf(spared.key)})`;
  return boundedPurgeOf(
    sql`organization_id = ${organizationId}::uuid and expires_at <= ${PURGE_CUTOFF} and ${own}`,
    INLINE_PURGE_LIMIT,
  );
}

/**
 * Function boundedPurgeOf
 *
 * @description
 * A delete of at most `limit` replay records matching `condition`, oldest first, skipping the rows
 * another transaction holds. The candidates are selected, limited and locked once, in a
 * materialized CTE, then deleted by primary key: a `LIMIT` inside an `IN (subquery)` can be
 * evaluated again by a semi-join, which would not bound the rows.
 *
 * @param {SQL} condition - Which records may go.
 * @param {number} limit - The most rows the statement deletes.
 * @returns {SQL} The statement.
 */
export function boundedPurgeOf(condition: SQL, limit: number): SQL {
  return sql`with candidates as materialized (
      select organization_id, actor_user_id, key_digest from ${invitationBatchReplays}
      where ${condition}
      order by expires_at
      limit ${limit}
      for update skip locked)
    delete from ${invitationBatchReplays} as replay using candidates
    where replay.organization_id = candidates.organization_id
      and replay.actor_user_id = candidates.actor_user_id
      and replay.key_digest = candidates.key_digest`;
}

/**
 * Constant REPLAY_WINDOW
 *
 * @description
 * `INVITATION_BATCH_REPLAY_MS` as a PostgreSQL interval.
 *
 * @type {SQL}
 */
const REPLAY_WINDOW: SQL = sql`make_interval(secs => ${INVITATION_BATCH_REPLAY_MS / 1000})`;

/**
 * Function digestOf
 *
 * @description
 * The SHA-256 digest, in hexadecimal, under which a key or a canonical batch is stored and locked:
 * neither the key the client chose nor the addresses of the batch reach these columns.
 *
 * @param {string} value - The key, or the canonical form of a batch.
 * @returns {string} Its digest.
 */
function digestOf(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Constant LEASE_WINDOW
 *
 * @description
 * `INVITATION_BATCH_LEASE_MS` as a PostgreSQL interval.
 *
 * @type {SQL}
 */
const LEASE_WINDOW: SQL = sql`make_interval(secs => ${INVITATION_BATCH_LEASE_MS / 1000})`;

/**
 * Function keyOf
 *
 * @description
 * The condition that names the row of a scoped key, by its primary key.
 *
 * @param {InvitationBatchReplayKey} key - The scoped key.
 * @returns {SQL | undefined} The condition.
 */
function keyOf(key: InvitationBatchReplayKey): SQL | undefined {
  return and(
    eq(invitationBatchReplays.organizationId, key.organizationId),
    eq(invitationBatchReplays.actorUserId, key.actorUserId),
    eq(invitationBatchReplays.keyDigest, digestOf(key.key)),
  );
}

/**
 * Class DrizzleInvitationBatchReplayRepository
 *
 * @description
 * `InvitationBatchReplayRepository` on `invitation_batch_replays`, in the tenant transaction of its
 * unit of work. A reservation is a `reserved` row with a `lease_id` and a 30-second lease, written
 * by one `insert … on conflict do update … where expires_at <= clock_timestamp()` statement: the
 * primary key decides between two requests under one key (the second waits only for the first's
 * short reservation transaction), and a row whose time ran out is taken over in the same statement.
 * The batch's transaction turns the reservation into a `committed` record by its `lease_id`; a
 * failed batch deletes it. Every instant is the database's `clock_timestamp()`, except in the purges,
 * which compare with `statement_timestamp()` to range-scan their indexes.
 */
export class DrizzleInvitationBatchReplayRepository implements InvitationBatchReplayRepository {
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
   * Method findLive
   *
   * @description
   * Loads the reservation or record of the scoped key that expires after `clock_timestamp()`, with
   * the actor's active membership in the same statement and without a lock, and whether its
   * fingerprint is the one of the batch of the request.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @returns {Promise<StoredInvitationBatch | null>} The reservation or record, or `null`.
   */
  public async findLive(
    key: InvitationBatchReplayKey,
    request: InvitationBatchRequest,
  ): Promise<StoredInvitationBatch | null> {
    const rows = await this.db
      .select({
        state: invitationBatchReplays.state,
        requestDigest: invitationBatchReplays.requestDigest,
        outcome: invitationBatchReplays.outcome,
        actorRole: members.role,
      })
      .from(invitationBatchReplays)
      .leftJoin(
        members,
        and(
          eq(members.organizationId, invitationBatchReplays.organizationId),
          eq(members.userId, invitationBatchReplays.actorUserId),
          isNull(members.removedAt),
        ),
      )
      .where(and(keyOf(key), gt(invitationBatchReplays.expiresAt, REPLAY_CLOCK)))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : {
          state: row.state,
          sameRequest: row.requestDigest === digestOf(request.canonical),
          invitations: row.outcome ?? [],
          actorRole: row.actorRole,
        };
  }

  /**
   * Method reserve
   *
   * @description
   * Takes over the row of the key if its time ran out and no transaction holds it (a batch in
   * flight holds its reservation from the start of its transaction, `renew`, so `for update skip
   * locked` never takes a live holder's key, nor waits for it); otherwise inserts the reservation
   * when the key has no row at all. A plain read decides between the two, since an insert against a
   * row that a batch is updating would wait for that batch; the insert itself waits only for
   * another request's short reservation of the same key, then finds its row.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @returns {Promise<string | null>} The id of the lease, or `null` when the key is live or held.
   */
  public async reserve(
    key: InvitationBatchReplayKey,
    request: InvitationBatchRequest,
  ): Promise<string | null> {
    const lease = {
      requestDigest: digestOf(request.canonical),
      state: 'reserved' as const,
      leaseId: sql`uuidv7()`,
      outcome: null,
      expiresAt: sql`${REPLAY_CLOCK} + ${LEASE_WINDOW}`,
      createdAt: sql`now()`,
    };
    const taken = await this.db.execute<{ lease_id: string }>(
      sql`with expired as materialized (
          select organization_id, actor_user_id, key_digest from ${invitationBatchReplays}
          where organization_id = ${key.organizationId}::uuid
            and actor_user_id = ${key.actorUserId}::uuid
            and key_digest = ${digestOf(key.key)}
            and expires_at <= ${REPLAY_CLOCK}
          for update skip locked)
        update ${invitationBatchReplays} as replay
        set request_digest = ${lease.requestDigest}, state = 'reserved', lease_id = uuidv7(),
            outcome = null, expires_at = ${REPLAY_CLOCK} + ${LEASE_WINDOW}, created_at = now()
        from expired
        where replay.organization_id = expired.organization_id
          and replay.actor_user_id = expired.actor_user_id
          and replay.key_digest = expired.key_digest
        returning replay.lease_id`,
    );
    if (taken.rows[0]?.lease_id !== undefined) {
      return taken.rows[0].lease_id;
    }
    // A row of the key that is live, or held by the transaction of its batch, keeps the key; an
    // insert against it would wait for that transaction, so a plain read decides first.
    const existing: { readonly keyDigest: string }[] = await this.db
      .select({ keyDigest: invitationBatchReplays.keyDigest })
      .from(invitationBatchReplays)
      .where(keyOf(key))
      .limit(1);
    if (existing.length > 0) {
      return null;
    }
    const inserted: { readonly leaseId: string | null }[] = await this.db
      .insert(invitationBatchReplays)
      .values({
        organizationId: key.organizationId,
        actorUserId: key.actorUserId,
        keyDigest: digestOf(key.key),
        ...lease,
      })
      .onConflictDoNothing()
      .returning({ leaseId: invitationBatchReplays.leaseId });
    return inserted[0]?.leaseId ?? null;
  }

  /**
   * Method renew
   *
   * @description
   * Renews the lease of `leaseId` from now and locks its row until the end of the transaction of
   * the batch: neither a takeover nor a purge, both `skip locked`, can touch it while the batch
   * runs, however long it takes.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {string} leaseId - The lease the batch holds.
   * @returns {Promise<boolean>} `false` when the lease is no longer the batch's.
   */
  public async renew(key: InvitationBatchReplayKey, leaseId: string): Promise<boolean> {
    const rows: { readonly keyDigest: string }[] = await this.db
      .update(invitationBatchReplays)
      .set({ expiresAt: sql`${REPLAY_CLOCK} + ${LEASE_WINDOW}` })
      .where(
        and(
          keyOf(key),
          eq(invitationBatchReplays.state, 'reserved'),
          eq(invitationBatchReplays.leaseId, leaseId),
        ),
      )
      .returning({ keyDigest: invitationBatchReplays.keyDigest });
    return rows.length === 1;
  }

  /**
   * Method complete
   *
   * @description
   * Turns the reservation of `leaseId` into the record, replayed for 24 hours from the database's
   * `clock_timestamp()`, then deletes at most `INLINE_PURGE_LIMIT` other expired rows of the
   * organization, never the row of the key itself.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {string} leaseId - The lease the batch holds.
   * @param {InvitationBatchReplay} replay - The batch and its outcome.
   * @returns {Promise<boolean>} `false` when the lease is no longer the batch's.
   */
  public async complete(
    key: InvitationBatchReplayKey,
    leaseId: string,
    replay: InvitationBatchReplay,
  ): Promise<boolean> {
    const rows: { readonly keyDigest: string }[] = await this.db
      .update(invitationBatchReplays)
      .set({
        state: 'committed',
        leaseId: null,
        requestDigest: digestOf(replay.request.canonical),
        outcome: replay.invitations,
        expiresAt: sql`${REPLAY_CLOCK} + ${REPLAY_WINDOW}`,
      })
      .where(
        and(
          keyOf(key),
          eq(invitationBatchReplays.state, 'reserved'),
          eq(invitationBatchReplays.leaseId, leaseId),
        ),
      )
      .returning({ keyDigest: invitationBatchReplays.keyDigest });
    if (rows.length !== 1) {
      return false;
    }
    await this.db.execute(inlinePurgeOf(key.organizationId, key));
    return true;
  }

  /**
   * Method release
   *
   * @description
   * Deletes the reservation of `leaseId`, if it is still there.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {string} leaseId - The lease the batch held.
   * @returns {Promise<void>} Resolves once deleted.
   */
  public async release(key: InvitationBatchReplayKey, leaseId: string): Promise<void> {
    await this.db
      .delete(invitationBatchReplays)
      .where(
        and(
          keyOf(key),
          eq(invitationBatchReplays.state, 'reserved'),
          eq(invitationBatchReplays.leaseId, leaseId),
        ),
      );
  }
  // #endregion
}
