import type { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { invitationBatchReplays } from '../../schemas/invitations/invitation-batch-replay.schema.js';
import { PURGE_CUTOFF } from './drizzle-invitation-batch-replay.repository.js';

/**
 * Function expiredPurgeOf
 *
 * @description
 * One bounded delete of expired records of every organization: at most `limit`, oldest first, by a
 * range scan of `invitation_batch_replays_expiry_index` up to the statement's instant, skipping the
 * rows a keyed batch is deleting at the same time.
 *
 * @param {number} limit - The most rows the statement deletes.
 * @returns {SQL} The statement.
 */
export function expiredPurgeOf(limit: number): SQL {
  return sql`delete from ${invitationBatchReplays}
    where (organization_id, actor_user_id, key_digest) in (
      select organization_id, actor_user_id, key_digest from ${invitationBatchReplays}
      where expires_at <= ${PURGE_CUTOFF}
      order by expires_at
      limit ${limit}
      for update skip locked)`;
}

/**
 * Class ExpiredInvitationBatchReplays
 *
 * @description
 * Deletes expired replay records of every organization, a bounded batch at a time, independently
 * of the tenants' traffic. Each batch is a system transaction of its own, a bounded exception of
 * `MODULE.md`: it names only rows whose replay is over.
 */
export class ExpiredInvitationBatchReplays {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Binds the purge to the system runner because it spans organizations.
   *
   * @param {SystemTransactionRunner} system - The system transaction runner.
   * @constructor
   */
  public constructor(private readonly system: SystemTransactionRunner) {}
  // #endregion

  // #region Methods
  /**
   * Method purge
   *
   * @description
   * Deletes at most `limit` expired records, the oldest first, in one system transaction.
   *
   * @param {number} limit - The most rows one call deletes.
   * @returns {Promise<number>} How many rows it deleted.
   */
  public purge(limit: number): Promise<number> {
    return this.system.run(async ({ db }) => {
      const result = await db.execute(expiredPurgeOf(limit));
      return result.rowCount ?? 0;
    });
  }

  /**
   * Method oldestExpiredAgeSeconds
   *
   * @description
   * How long ago, in whole seconds, the oldest record still in the table expired, read from the
   * start of `invitation_batch_replays_expiry_index`; the backlog of the purge.
   *
   * @returns {Promise<number | null>} The age, or `null` when no expired record remains.
   */
  public oldestExpiredAgeSeconds(): Promise<number | null> {
    return this.system.run(
      async ({ db }) => {
        const result = await db.execute<{ age: number | null }>(
          sql`select floor(extract(epoch from ${PURGE_CUTOFF} - min(expires_at)))::int as age
              from ${invitationBatchReplays} where expires_at <= ${PURGE_CUTOFF}`,
        );
        return result.rows[0]?.age ?? null;
      },
      { readOnly: true },
    );
  }
  // #endregion
}
