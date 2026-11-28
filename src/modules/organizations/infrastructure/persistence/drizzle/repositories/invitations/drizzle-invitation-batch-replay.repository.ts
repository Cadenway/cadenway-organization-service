import { createHash } from 'node:crypto';

import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, eq, gt, lte, sql } from 'drizzle-orm';

import type { InvitationBatchReplayKey } from '../../../../../application/models/invitations/invitation-batch-replay-key.model.js';
import type { InvitationBatchReplay } from '../../../../../application/models/invitations/invitation-batch-replay.model.js';
import type { InvitationBatchReplayRepository } from '../../../../../application/ports/outbound/persistence/invitations/invitation-batch-replay-repository.port.js';
import { InvitationBatchRequest } from '../../../../../domain/value-objects/invitations/invitation-batch-request.value-object.js';
import { invitationBatchReplays } from '../../schemas/invitations/invitation-batch-replay.schema.js';

/**
 * Function keyDigest
 *
 * @description
 * The SHA-256 digest, in hexadecimal, an `Idempotency-Key` is stored and locked under: the key the
 * client chose never reaches the database.
 *
 * @param {string} key - The key.
 * @returns {string} Its digest.
 */
function keyDigest(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Class DrizzleInvitationBatchReplayRepository
 *
 * @description
 * `InvitationBatchReplayRepository` on `invitation_batch_replays`, in the tenant transaction of the
 * batch. The in-progress marker is a transaction-level advisory lock on the scoped key, taken with
 * `pg_try_advisory_xact_lock`: PostgreSQL releases it at commit or rollback, and when the
 * connection ends, so a crashed process frees the key at once and a stalled transaction holds it no
 * longer than the `statement_timeout` (10 s) and `idle_in_transaction_session_timeout` (30 s) of
 * the application role. The primary key of the table backs it: of two transactions that store a
 * record of one key, the second waits for the first and stores nothing.
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
   * Method tryClaim
   *
   * @description
   * Takes the advisory lock of the scoped key for the transaction, without waiting.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @returns {Promise<boolean>} `false` when another transaction holds it.
   */
  public async tryClaim(key: InvitationBatchReplayKey): Promise<boolean> {
    const result = await this.db.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended('invitation-batch:' || ${key.organizationId}::uuid::text || ':' || ${key.actorUserId}::uuid::text || ':' || ${keyDigest(key.key)}, 0)) as acquired`,
    );
    return result.rows[0]?.acquired === true;
  }

  /**
   * Method findLive
   *
   * @description
   * Loads the record of the scoped key that expires after `now`.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {Date} now - The instant of the request.
   * @returns {Promise<InvitationBatchReplay | null>} The record, or `null`.
   */
  public async findLive(
    key: InvitationBatchReplayKey,
    now: Date,
  ): Promise<InvitationBatchReplay | null> {
    const rows = await this.db
      .select({ request: invitationBatchReplays.request, outcome: invitationBatchReplays.outcome })
      .from(invitationBatchReplays)
      .where(
        and(
          eq(invitationBatchReplays.organizationId, key.organizationId),
          eq(invitationBatchReplays.actorUserId, key.actorUserId),
          eq(invitationBatchReplays.keyDigest, keyDigest(key.key)),
          gt(invitationBatchReplays.expiresAt, now),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : { request: InvitationBatchRequest.restore(row.request), invitations: row.outcome };
  }

  /**
   * Method record
   *
   * @description
   * Deletes the records of the organization expired at `now`, an expired record of this key
   * included, then inserts the record unless one of the key exists.
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
    await this.db
      .delete(invitationBatchReplays)
      .where(
        and(
          eq(invitationBatchReplays.organizationId, key.organizationId),
          lte(invitationBatchReplays.expiresAt, window.now),
        ),
      );
    const inserted: { readonly organizationId: string }[] = await this.db
      .insert(invitationBatchReplays)
      .values({
        organizationId: key.organizationId,
        actorUserId: key.actorUserId,
        keyDigest: keyDigest(key.key),
        request: replay.request.snapshot,
        outcome: replay.invitations,
        expiresAt: window.expiresAt,
      })
      .onConflictDoNothing()
      .returning({ organizationId: invitationBatchReplays.organizationId });
    return inserted.length === 1;
  }
  // #endregion
}
