import type { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { invitationBatchReplays } from '../../schemas/invitations/invitation-batch-replay.schema.js';
import { boundedPurgeOf, PURGE_CUTOFF } from './drizzle-invitation-batch-replay.repository.js';

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
  return boundedPurgeOf(sql`expires_at <= ${PURGE_CUTOFF}`, limit);
}

/**
 * Function timeoutOf
 *
 * @description
 * The `statement_timeout` a transaction of the purge sets for itself: the time left to its tick,
 * in whole milliseconds and 1 at least (0 would disable the timeout).
 *
 * @param {number} timeoutMs - The time left, in milliseconds.
 * @returns {string} The setting.
 */
function timeoutOf(timeoutMs: number): string {
  return `${String(Math.max(1, Math.floor(timeoutMs)))}ms`;
}

/**
 * Interface PurgeWindow
 *
 * @description
 * When a call of the purge must be over, and the signal that cancels it sooner.
 */
export interface PurgeWindow {
  // #region Properties
  /**
   * Property deadline
   *
   * @description
   * The instant, in milliseconds on the clock of the repository, the call must be over by.
   *
   * @type {number}
   * @readonly
   */
  readonly deadline: number;

  /**
   * Property signal
   *
   * @description
   * The abort signal of the job.
   *
   * @type {AbortSignal}
   * @readonly
   */
  readonly signal: AbortSignal;
  // #endregion
}

/**
 * Class ExpiredInvitationBatchReplays
 *
 * @description
 * Deletes expired replay records of every organization, a bounded batch at a time, independently
 * of the tenants' traffic. Each batch is a system transaction of its own, a bounded exception of
 * `MODULE.md`: it names only rows whose replay is over. A call takes an absolute deadline: once its
 * transaction holds a connection (the wait for one counts), it runs nothing when the deadline or
 * the job's abort has come, and otherwise caps its statements at the time left
 * (`statement_timeout`, which counts lock waits too), so a purge never outlasts its tick: a
 * statement cut short fails, rolls its batch back and leaves the rows to the next tick.
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
   * @param {() => number} now - The clock of the deadlines, in milliseconds.
   * @constructor
   */
  public constructor(
    private readonly system: SystemTransactionRunner,
    private readonly now: () => number = Date.now,
  ) {}
  // #endregion

  // #region Methods
  /**
   * Method purge
   *
   * @description
   * Deletes at most `limit` expired records, the oldest first, in one system transaction that ends
   * by the deadline of `window`.
   *
   * @param {number} limit - The most rows one call deletes.
   * @param {PurgeWindow} window - The deadline and the abort signal.
   * @returns {Promise<number | null>} How many rows it deleted, or `null` when no time was left
   * once the transaction began.
   */
  public purge(limit: number, window: PurgeWindow): Promise<number | null> {
    return this.system.run(async ({ db }) => {
      const timeout: string | null = this.timeoutWithin(window);
      if (timeout === null) {
        return null;
      }
      await db.execute(sql`select set_config('statement_timeout', ${timeout}, true)`);
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
   * @param {PurgeWindow} window - The deadline and the abort signal.
   * @returns {Promise<number | null>} The age, or `null` when no expired record remains or no time
   * was left once the transaction began.
   */
  public oldestExpiredAgeSeconds(window: PurgeWindow): Promise<number | null> {
    return this.system.run(
      async ({ db }) => {
        const timeout: string | null = this.timeoutWithin(window);
        if (timeout === null) {
          return null;
        }
        await db.execute(sql`select set_config('statement_timeout', ${timeout}, true)`);
        const result = await db.execute<{ age: number | null }>(
          sql`select floor(extract(epoch from ${PURGE_CUTOFF} - min(expires_at)))::int as age
              from ${invitationBatchReplays} where expires_at <= ${PURGE_CUTOFF}`,
        );
        return result.rows[0]?.age ?? null;
      },
      { readOnly: true },
    );
  }

  /**
   * Method timeoutWithin
   *
   * @description
   * The `statement_timeout` left to a call once its transaction holds a connection, or `null` when
   * its deadline or its abort has come.
   *
   * @param {PurgeWindow} window - The deadline and the abort signal.
   * @returns {string | null} The setting, or `null` to run nothing.
   */
  private timeoutWithin(window: PurgeWindow): string | null {
    const remaining: number = window.deadline - this.now();
    return remaining <= 0 || window.signal.aborted ? null : timeoutOf(remaining);
  }
  // #endregion
}
