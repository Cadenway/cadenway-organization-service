import { createHash } from 'node:crypto';

import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, eq, gt, lte, sql } from 'drizzle-orm';

import type { InvitationBatchReplayKey } from '../../../../../application/models/invitations/invitation-batch-replay-key.model.js';
import type { InvitationBatchReplay } from '../../../../../application/models/invitations/invitation-batch-replay.model.js';
import type { StoredInvitationBatch } from '../../../../../application/models/invitations/stored-invitation-batch.model.js';
import type { InvitationBatchReplayRepository } from '../../../../../application/ports/outbound/persistence/invitations/invitation-batch-replay-repository.port.js';
import type { InvitationBatchRequest } from '../../../../../domain/value-objects/invitations/invitation-batch-request.value-object.js';
import { invitationBatchReplays } from '../../schemas/invitations/invitation-batch-replay.schema.js';

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
 * fingerprint of the batch, taken with `pg_try_advisory_xact_lock`: PostgreSQL releases it at
 * commit or rollback, and when the connection ends, so a crashed process frees the key at once and
 * a stalled transaction holds it no longer than the `statement_timeout` (10 s) and
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
   * Loads the committed record of the scoped key that expires after `now`, and whether its
   * fingerprint is the one of the batch of the request.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @param {Date} now - The instant of the request.
   * @returns {Promise<StoredInvitationBatch | null>} The record, or `null`.
   */
  public async findLive(
    key: InvitationBatchReplayKey,
    request: InvitationBatchRequest,
    now: Date,
  ): Promise<StoredInvitationBatch | null> {
    const rows = await this.db
      .select({
        requestDigest: invitationBatchReplays.requestDigest,
        outcome: invitationBatchReplays.outcome,
      })
      .from(invitationBatchReplays)
      .where(
        and(
          eq(invitationBatchReplays.organizationId, key.organizationId),
          eq(invitationBatchReplays.actorUserId, key.actorUserId),
          eq(invitationBatchReplays.keyDigest, digestOf(key.key)),
          gt(invitationBatchReplays.expiresAt, now),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : {
          sameRequest: row.requestDigest === digestOf(request.canonical),
          invitations: row.outcome,
        };
  }

  /**
   * Method tryClaim
   *
   * @description
   * Takes the advisory lock of the scoped key and the batch's fingerprint for the transaction,
   * without waiting.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @returns {Promise<boolean>} `false` when another transaction holds it.
   */
  public async tryClaim(
    key: InvitationBatchReplayKey,
    request: InvitationBatchRequest,
  ): Promise<boolean> {
    const result = await this.db.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended('invitation-batch:' || ${key.organizationId}::uuid::text || ':' || ${key.actorUserId}::uuid::text || ':' || ${digestOf(key.key)} || ':' || ${digestOf(request.canonical)}, 0)) as acquired`,
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
   * nothing once it commits.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchReplay} replay - The batch and its outcome.
   * @param {{ readonly now: Date; readonly expiresAt: Date }} window - The instant of the batch and
   * the end of its replay.
   * @returns {Promise<boolean>} `false` when a record of the key already exists.
   */
  public async record(
    key: InvitationBatchReplayKey,
    replay: InvitationBatchReplay,
    window: { readonly now: Date; readonly expiresAt: Date },
  ): Promise<boolean> {
    const keyDigest: string = digestOf(key.key);
    await this.db
      .delete(invitationBatchReplays)
      .where(
        and(
          eq(invitationBatchReplays.organizationId, key.organizationId),
          eq(invitationBatchReplays.actorUserId, key.actorUserId),
          eq(invitationBatchReplays.keyDigest, keyDigest),
          lte(invitationBatchReplays.expiresAt, window.now),
        ),
      );
    await this.db.execute(
      sql`delete from ${invitationBatchReplays}
          where (organization_id, actor_user_id, key_digest) in (
            select organization_id, actor_user_id, key_digest from ${invitationBatchReplays}
            where organization_id = ${key.organizationId}::uuid
              and expires_at <= ${window.now.toISOString()}::timestamptz
            order by expires_at
            limit ${INLINE_PURGE_LIMIT}
            for update skip locked)`,
    );
    const inserted: { readonly organizationId: string }[] = await this.db
      .insert(invitationBatchReplays)
      .values({
        organizationId: key.organizationId,
        actorUserId: key.actorUserId,
        keyDigest,
        requestDigest: digestOf(replay.request.canonical),
        outcome: replay.invitations,
        expiresAt: window.expiresAt,
      })
      .onConflictDoNothing()
      .returning({ organizationId: invitationBatchReplays.organizationId });
    return inserted.length === 1;
  }
  // #endregion
}
