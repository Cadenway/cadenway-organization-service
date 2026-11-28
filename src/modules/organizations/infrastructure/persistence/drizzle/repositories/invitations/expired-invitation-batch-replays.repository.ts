import type {
  SystemTransactionRunner,
  TransactionDatabase,
  TransactionOptions,
} from '@cadenway/nest-common/database';
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
 * `MODULE.md`: it names only rows whose replay is over. A call takes an absolute deadline and the
 * job's abort signal: the wait for a pooled connection races them (`within`), and once the
 * transaction holds one in time its statements are capped at the time left (`statement_timeout`,
 * which counts lock waits too), so a purge never outlasts its tick: a statement cut short fails,
 * rolls its batch back and leaves the rows to the next tick.
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
    return this.within(window, {}, async (db: TransactionDatabase): Promise<number> => {
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
    return this.within(
      window,
      { readOnly: true },
      async (db: TransactionDatabase): Promise<number | null> => {
        const result = await db.execute<{ age: number | null }>(
          sql`select floor(extract(epoch from ${PURGE_CUTOFF} - min(expires_at)))::int as age
              from ${invitationBatchReplays} where expires_at <= ${PURGE_CUTOFF}`,
        );
        return result.rows[0]?.age ?? null;
      },
    );
  }

  /**
   * Method within
   *
   * @description
   * Runs `work` in a system transaction bounded by `window`, the wait for a pooled connection
   * included. The checkout races the deadline and the abort signal: if either comes first, the call
   * answers `null` at once, and the transaction, whenever it gets its connection, runs no statement
   * of its own and ends, which gives the connection back to the pool. Once the transaction holds its
   * connection in time, the race is over: `statement_timeout` is set to the time left, then the
   * deadline and the abort are checked once more, right before `work`, which does not run if either
   * came during that round trip. The time `work` may take is thus the time left before the setting,
   * which overruns the deadline by the latency of one `set_config` at most.
   *
   * @param {PurgeWindow} window - The deadline and the abort signal.
   * @param {TransactionOptions} options - How the transaction is opened.
   * @param {(db: TransactionDatabase) => Promise<TResult>} work - The statements of the call.
   * @returns {Promise<TResult | null>} What `work` resolved with, or `null` without time left.
   */
  private within<TResult>(
    window: PurgeWindow,
    options: TransactionOptions,
    work: (db: TransactionDatabase) => Promise<TResult>,
  ): Promise<TResult | null> {
    const left: number = window.deadline - this.now();
    if (left <= 0 || window.signal.aborted) {
      return Promise.resolve(null);
    }
    return new Promise<TResult | null>((resolve, reject) => {
      let state: 'checking-out' | 'running' | 'abandoned' = 'checking-out';
      const race: { timer?: ReturnType<typeof setTimeout> } = {};
      const listeners: { abandon: () => void } = { abandon: (): void => undefined };
      const stopRace = (): void => {
        clearTimeout(race.timer);
        window.signal.removeEventListener('abort', listeners.abandon);
      };
      listeners.abandon = (): void => {
        if (state === 'checking-out') {
          state = 'abandoned';
          stopRace();
          resolve(null);
        }
      };
      const abandon = listeners.abandon;
      race.timer = setTimeout(abandon, left);
      window.signal.addEventListener('abort', abandon, { once: true });
      this.system
        .run(async ({ db }): Promise<TResult | null> => {
          const remaining: number = window.deadline - this.now();
          if (state === 'abandoned' || remaining <= 0 || window.signal.aborted) {
            abandon();
            return null;
          }
          state = 'running';
          stopRace();
          await db.execute(
            sql`select set_config('statement_timeout', ${timeoutOf(remaining)}, true)`,
          );
          // The setting took a round trip: the deadline or the abort may have come meanwhile.
          if (this.isOver(window)) {
            return null;
          }
          return work(db);
        }, options)
        .then(
          (value: TResult | null): void => {
            stopRace();
            resolve(value);
          },
          (error: unknown): void => {
            stopRace();
            // A transaction the call gave up on can only fail on its own; nobody waits for it.
            if (state !== 'abandoned') {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          },
        );
    });
  }

  /**
   * Method isOver
   *
   * @description
   * Whether the deadline or the abort of a call has come, read afresh at each call.
   *
   * @param {PurgeWindow} window - The deadline and the abort signal.
   * @returns {boolean} `true` when the call must stop.
   */
  private isOver(window: PurgeWindow): boolean {
    return window.deadline - this.now() <= 0 || window.signal.aborted;
  }
  // #endregion
}
