import { createHash } from 'node:crypto';

import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { InvitationBatchReplayKey } from '../../../../../application/models/invitations/invitation-batch-replay-key.model.js';
import type { InvitationBatchReplay } from '../../../../../application/models/invitations/invitation-batch-replay.model.js';
import type { StoredInvitationBatch } from '../../../../../application/models/invitations/stored-invitation-batch.model.js';
import type { InvitationBatchReplayRepository } from '../../../../../application/ports/outbound/persistence/invitations/invitation-batch-replay-repository.port.js';
import { INVITATION_BATCH_REPLAY_MS } from '../../../../../domain/policies/invitations/invitation-batch-replay.policy.js';
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
 * rows another transaction is deleting.
 *
 * @param {string} organizationId - The organization of the batch.
 * @returns {SQL} The statement.
 */
export function inlinePurgeOf(organizationId: string): SQL {
  return boundedPurgeOf(
    sql`organization_id = ${organizationId}::uuid and expires_at <= ${PURGE_CUTOFF}`,
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
 * Class DrizzleInvitationBatchReplayRepository
 *
 * @description
 * `InvitationBatchReplayRepository` on `invitation_batch_replays`, in the tenant transaction of the
 * batch. The in-progress marker is a transaction-level advisory lock on the scoped key and the
 * fingerprint of the batch, taken with `pg_try_advisory_xact_lock`, never awaited: PostgreSQL
 * releases it at commit or rollback, and when the connection ends, so a crashed process frees the
 * key at once and a stalled transaction holds it no longer than the `statement_timeout` (10 s) and
 * `idle_in_transaction_session_timeout` (30 s) of the application role. Another batch under the
 * same key takes another lock; the primary key of the table decides between them, the second
 * storing nothing once the first commits.
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
   * Loads the committed record of the scoped key that expires after `clock_timestamp()`, and
   * whether its fingerprint is the one of the batch of the request.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @returns {Promise<StoredInvitationBatch | null>} The record, or `null`.
   */
  public async findLive(
    key: InvitationBatchReplayKey,
    request: InvitationBatchRequest,
  ): Promise<StoredInvitationBatch | null> {
    const rows = await this.db
      .select({
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
      .where(
        and(
          eq(invitationBatchReplays.organizationId, key.organizationId),
          eq(invitationBatchReplays.actorUserId, key.actorUserId),
          eq(invitationBatchReplays.keyDigest, digestOf(key.key)),
          gt(invitationBatchReplays.expiresAt, REPLAY_CLOCK),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : {
          sameRequest: row.requestDigest === digestOf(request.canonical),
          invitations: row.outcome,
          actorRole: row.actorRole,
        };
  }

  /**
   * Method tryClaim
   *
   * @description
   * Takes the advisory lock of the scoped key and the batch's fingerprint for the transaction,
   * without waiting, so a request never holds a pooled connection while another batch runs.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @returns {Promise<boolean>} `false` when another transaction holds it.
   */
  public async tryClaim(
    key: InvitationBatchReplayKey,
    request: InvitationBatchRequest,
  ): Promise<boolean> {
    const name: string = `invitation-batch:${key.organizationId.toLowerCase()}:${key.actorUserId.toLowerCase()}:${digestOf(key.key)}:${digestOf(request.canonical)}`;
    const result = await this.db.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${name}, 0)) as acquired`,
    );
    return result.rows[0]?.acquired === true;
  }

  /**
   * Method record
   *
   * @description
   * Deletes the expired record of the key, and at most `INLINE_PURGE_LIMIT` other expired records
   * of the organization that no other transaction holds, then inserts the record unless one of the
   * key exists. The insert waits for a transaction that inserted the same key first, and stores
   * nothing once it commits. `expires_at` is `REPLAY_WINDOW` after `clock_timestamp()` at the
   * insert, the last statement of the batch, so the time it waited on its locks does not count.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchReplay} replay - The batch and its outcome.
   * @returns {Promise<boolean>} `false` when a record of the key already exists.
   */
  public async record(
    key: InvitationBatchReplayKey,
    replay: InvitationBatchReplay,
  ): Promise<boolean> {
    const keyDigest: string = digestOf(key.key);
    await this.db
      .delete(invitationBatchReplays)
      .where(
        and(
          eq(invitationBatchReplays.organizationId, key.organizationId),
          eq(invitationBatchReplays.actorUserId, key.actorUserId),
          eq(invitationBatchReplays.keyDigest, keyDigest),
          lte(invitationBatchReplays.expiresAt, PURGE_CUTOFF),
        ),
      );
    await this.db.execute(inlinePurgeOf(key.organizationId));
    const inserted: { readonly organizationId: string }[] = await this.db
      .insert(invitationBatchReplays)
      .values({
        organizationId: key.organizationId,
        actorUserId: key.actorUserId,
        keyDigest,
        requestDigest: digestOf(replay.request.canonical),
        outcome: replay.invitations,
        expiresAt: sql`${REPLAY_CLOCK} + ${REPLAY_WINDOW}`,
      })
      .onConflictDoNothing()
      .returning({ organizationId: invitationBatchReplays.organizationId });
    return inserted.length === 1;
  }
  // #endregion
}
