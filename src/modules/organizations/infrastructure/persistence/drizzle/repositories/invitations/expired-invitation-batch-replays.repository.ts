import type { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';

import { invitationBatchReplays } from '../../schemas/invitations/invitation-batch-replay.schema.js';

/**
 * Class ExpiredInvitationBatchReplays
 *
 * @description
 * Deletes expired replay records of every organization, a bounded batch at a time, independently
 * of the tenants' traffic. A system transaction, a bounded exception of `MODULE.md`: it names only
 * rows whose replay is over, by `invitation_batch_replays_expiry_index`, and skips the rows a keyed
 * batch is deleting at the same time.
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
   * Deletes at most `limit` records expired at the start of the statement, the oldest first.
   *
   * @param {number} limit - The most rows one call deletes.
   * @returns {Promise<number>} How many rows it deleted.
   */
  public purge(limit: number): Promise<number> {
    const replays = invitationBatchReplays;
    return this.system.run(async ({ db }) => {
      const result = await db.execute(
        sql`delete from ${replays}
            where (organization_id, actor_user_id, key_digest) in (
              select organization_id, actor_user_id, key_digest from ${replays}
              where expires_at <= statement_timestamp()
              order by expires_at
              limit ${limit}
              for update skip locked)`,
      );
      return result.rowCount ?? 0;
    });
  }
  // #endregion
}
