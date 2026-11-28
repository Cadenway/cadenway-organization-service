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
import type { KeyedInvitationBatchUsage } from '../../../../../domain/value-objects/invitations/keyed-invitation-batch-usage.value-object.js';
import { isLockTimeout } from '../../mappers/postgres/lock-timeout.mapper.js';
import { invitationBatchReplays } from '../../schemas/invitations/invitation-batch-replay.schema.js';
import { members } from '../../schemas/members/member.schema.js';
import { organizations } from '../../schemas/organizations/organization.schema.js';

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
 * Constant RESERVATION_LOCK_TIMEOUT
 *
 * @description
 * The `lock_timeout` of a reservation's statements: a backstop, far below the 5 s of the
 * application role, so a reservation that would wait on a transaction holding the key's row gives
 * up at once instead of holding a pooled connection.
 *
 * @type {string}
 */
const RESERVATION_LOCK_TIMEOUT: string = '100ms';

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
 * Function reclaimedReservationsOf
 *
 * @description
 * The delete an admission runs before it counts: at most `budget` reservations of the
 * organization whose lease ran out and that no transaction holds, by
 * `invitation_batch_replays_reservation_index`, locked with `for update skip locked`, so it never
 * waits. A reservation that a batch still runs holds its row lock from the batch's first
 * statement (`renew`, an `update`, then `complete`, both in the batch's transaction) until that
 * transaction ends, so it is skipped and keeps counting, its renewal possibly invisible to this
 * snapshot. A row it can lock belongs to a holder that crashed, gave up or has not started its
 * batch yet: deleting it in the admission's transaction makes that holder's later `renew` find no
 * lease and roll its batch back, so the place it frees can never be filled twice. A row whose
 * holder committed or rolled back meanwhile is read again by the lock: a record is no longer a
 * reservation and stays, an aborted reservation goes.
 *
 * @param {string} organizationId - The organization.
 * @param {number} budget - The replay record budget, which bounds the delete.
 * @returns {SQL} The statement.
 */
export function reclaimedReservationsOf(organizationId: string, budget: number): SQL {
  return boundedPurgeOf(
    sql`organization_id = ${organizationId}::uuid and state = 'reserved'
      and expires_at <= ${PURGE_CUTOFF}`,
    budget,
  );
}

/**
 * Function keyedBatchUsageOf
 *
 * @description
 * The read of the replay record budget of an organization once `reclaimedReservationsOf` ran in
 * the same transaction, one statement and so one snapshot:
 *
 * - its reservations, whatever their lease, counted up to `budget` by
 *   `invitation_batch_replays_reservation_index`, which holds no record: those under a live lease,
 *   and those past it that the reclaim had to skip because a running batch still holds them (or,
 *   for a moment, a purge deleting them, which counts them once more than needed);
 * - the expiries of its newest live records, backward from the newest by
 *   `invitation_batch_replays_organization_expiry_index`, no more than the places the
 *   reservations leave.
 *
 * Neither part reads more than `budget` index entries plus the reservations among the records,
 * whatever the organization holds. A record counts while its time runs at `statement_timestamp()`,
 * the instant of the read; expiries come back in whole milliseconds, rounded up, so a place is
 * never announced before it frees up.
 *
 * @param {string} organizationId - The organization.
 * @param {number} budget - The replay record budget.
 * @returns {SQL} The statement, answering `running`, `read_at` and `stored` (epoch milliseconds).
 */
export function keyedBatchUsageOf(organizationId: string, budget: number): SQL {
  return sql`with running as materialized (
      select count(*)::int as count from (
        select 1 from ${invitationBatchReplays}
        where organization_id = ${organizationId}::uuid and state = 'reserved'
        limit ${budget}::int) as held),
    stored as materialized (
      select expires_at from ${invitationBatchReplays}
      where organization_id = ${organizationId}::uuid
        and expires_at > ${PURGE_CUTOFF}
        and state = 'committed'
      order by expires_at desc
      limit greatest(${budget}::int - (select count from running), 0))
    select (select count from running) as running,
      floor(extract(epoch from ${PURGE_CUTOFF}) * 1000)::float8 as read_at,
      coalesce(
        (select json_agg(ceil(extract(epoch from expires_at) * 1000)::float8) from stored),
        '[]'::json) as stored`;
}

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
   * Method lockReservations
   *
   * @description
   * Takes a `for key share` lock on the organization, the lock the foreign key of an insert needs,
   * under the normal lock timeout of the role, so that a long change of the organization is waited
   * for, not mistaken for a held key; then a transaction advisory lock on the reservations of the
   * organization, under the same timeout, which serializes the check of its replay record budget
   * and the reservation of a key per organization. Only the short reservation transactions take
   * it, never a running batch, so it is never held for longer than a few statements.
   *
   * @param {string} organizationId - The organization of the transaction.
   * @returns {Promise<void>} Resolves once both locks are held.
   */
  public async lockReservations(organizationId: string): Promise<void> {
    // The foreign key of an insert takes this lock too: taken here, under the normal lock timeout
    // of the role, a long change of the organization makes the reservation wait for it rather than
    // time out in the claim and answer a false 409.
    await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .for('key share');
    await this.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`invitation-batch-budget:${organizationId.toLowerCase()}`}, 0))`,
    );
  }

  /**
   * Method usage
   *
   * @description
   * First deletes the reservations of the organization whose lease ran out and that no
   * transaction holds (`reclaimedReservationsOf`), without waiting; then counts, in one statement
   * and so one snapshot, its remaining reservations up to `budget`, which a running batch keeps
   * holding until it can no longer commit, and reads the expiries of its newest live records, no
   * more than the places the reservations leave (`keyedBatchUsageOf`). The delete commits only
   * with the reservation the admission then takes; a refusal rolls it back with the rest.
   *
   * @param {string} organizationId - The organization of the transaction.
   * @param {number} budget - The replay record budget.
   * @returns {Promise<KeyedInvitationBatchUsage>} The usage.
   */
  public async usage(organizationId: string, budget: number): Promise<KeyedInvitationBatchUsage> {
    await this.db.execute(reclaimedReservationsOf(organizationId, budget));
    const result = await this.db.execute<{
      running: number;
      read_at: number;
      stored: number[];
    }>(keyedBatchUsageOf(organizationId, budget));
    const row = result.rows[0];
    return {
      running: row?.running ?? 0,
      newestStoredExpiries: (row?.stored ?? []).map((epochMs: number) => new Date(epochMs)),
      readAt: new Date(row?.read_at ?? 0),
    };
  }

  /**
   * Method isReserved
   *
   * @description
   * Whether the key still has a reservation, whatever its lease, by its primary key and without a
   * lock. After `usage` in the same transaction, a reservation whose lease ran out is still there
   * only because a running batch holds it.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @returns {Promise<boolean>} `true` while a batch of the key may still commit.
   */
  public async isReserved(key: InvitationBatchReplayKey): Promise<boolean> {
    const rows: { readonly keyDigest: string }[] = await this.db
      .select({ keyDigest: invitationBatchReplays.keyDigest })
      .from(invitationBatchReplays)
      .where(and(keyOf(key), eq(invitationBatchReplays.state, 'reserved')))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Method reserve
   *
   * @description
   * Reserves the key without ever waiting on a batch in flight, once `lockReservations` holds the
   * organization and its reservations. The claim runs in a savepoint under
   * a `lock_timeout` of `RESERVATION_LOCK_TIMEOUT`: a wait that reaches it rolls the savepoint back
   * and answers `null`. A transaction advisory lock on the key, held only by the short reservation
   * transactions, serializes the requests that reserve one key: the second waits for the first to
   * commit its reservation (milliseconds, within the timeout), then sees it. Under it, a row of the
   * key whose time ran out and that no transaction holds is taken over (`for update skip locked`);
   * a plain read then keeps a live or held row; only a key without any row gets an insert, which
   * can conflict only with a row no reservation could see, and then times out rather than wait.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @returns {Promise<string | null>} The id of the lease, or `null` when the key is not free.
   */
  public async reserve(
    key: InvitationBatchReplayKey,
    request: InvitationBatchRequest,
  ): Promise<string | null> {
    await this.db.execute(
      sql`select set_config('lock_timeout', ${RESERVATION_LOCK_TIMEOUT}, true)`,
    );
    await this.db.execute(sql`savepoint invitation_batch_reservation`);
    try {
      // Waits only for another request that reserves the key, a short transaction, and no longer
      // than the lock timeout.
      await this.db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`invitation-batch-reservation:${key.organizationId.toLowerCase()}:${key.actorUserId.toLowerCase()}:${digestOf(key.key)}`}, 0))`,
      );
      const leaseId: string | null = await this.reserveFree(key, request);
      await this.db.execute(sql`release savepoint invitation_batch_reservation`);
      return leaseId;
    } catch (error) {
      if (!isLockTimeout(error)) {
        throw error;
      }
      await this.db.execute(sql`rollback to savepoint invitation_batch_reservation`);
      return null;
    }
  }

  /**
   * Method reserveFree
   *
   * @description
   * Under the reservation lock of the key: takes over its expired row that no transaction holds,
   * keeps a live or held row, or inserts the reservation of a key without any row.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @returns {Promise<string | null>} The id of the lease, or `null` when the key is not free.
   */
  private async reserveFree(
    key: InvitationBatchReplayKey,
    request: InvitationBatchRequest,
  ): Promise<string | null> {
    const requestDigest: string = digestOf(request.canonical);
    const taken = await this.db.execute<{ lease_id: string }>(
      sql`with expired as materialized (
          select organization_id, actor_user_id, key_digest from ${invitationBatchReplays}
          where organization_id = ${key.organizationId}::uuid
            and actor_user_id = ${key.actorUserId}::uuid
            and key_digest = ${digestOf(key.key)}
            and expires_at <= ${REPLAY_CLOCK}
          for update skip locked)
        update ${invitationBatchReplays} as replay
        set request_digest = ${requestDigest}, state = 'reserved', lease_id = uuidv7(),
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
    // A row of the key that is live, or held by the transaction of its batch, keeps the key.
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
        requestDigest,
        state: 'reserved',
        leaseId: sql`uuidv7()`,
        outcome: null,
        expiresAt: sql`${REPLAY_CLOCK} + ${LEASE_WINDOW}`,
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
