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
  // #region Properties
  /**
   * Property abandonedCall
   *
   * @description
   * A call the purge gave up on (its deadline or its abort won) whose transaction has not ended
   * yet, and may still hold a pooled connection; `null` otherwise. While it is there, no other call
   * checks a connection out: at most one database call of the purge is in flight in the process.
   *
   * @type {Promise<void> | null}
   */
  private abandonedCall: Promise<void> | null = null;

  /**
   * Property stalled
   *
   * @description
   * Whether a call the purge gave up on still runs, so that the purge must not start another.
   *
   * @type {boolean}
   */
  public get stalled(): boolean {
    return this.abandonedCall !== null;
  }
  // #endregion

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
    return this.within(window, {}, 'fail', async (db: TransactionDatabase): Promise<number> => {
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
      'skip',
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
   * Runs `work` in a system transaction bounded by `window`, from the wait for a pooled connection
   * to the commit. The whole transaction races the deadline and the abort signal: if either comes
   * first, the call never waits for the transaction. It answers `null` when no statement of `work`
   * had started (no time left, the normal end of a tick), and, under `cutShort: 'fail'`, rejects
   * when one was in flight or committing, since the server may have cancelled it: the job then
   * fails and its queue's bounded retry applies, instead of a tick acknowledged as done. Left behind, the
   * transaction runs no statement of its own past that point (it checks before each one), and the
   * server ends it within the time that was left when it began: its first statement sets both
   * `statement_timeout` and `idle_in_transaction_session_timeout` to that time, so a statement that
   * runs too long is cancelled and a transaction left idle, a stalled commit's included, has its
   * session terminated, which the pool discards instead of reusing. The kit's runner does not give
   * the connection to its caller, so it cannot be destroyed from here; these two timeouts are the
   * bound: at most the time left at the start of the transaction past its first statement.
   *
   * @param {PurgeWindow} window - The deadline and the abort signal.
   * @param {TransactionOptions} options - How the transaction is opened.
   * @param {'fail' | 'skip'} cutShort - What a deadline or an abort that comes while `work` runs
   * does: `fail` rejects the call (a delete the server may have cancelled must fail its job, so its
   * queue retries it), `skip` answers `null` (a read).
   * @param {(db: TransactionDatabase) => Promise<TResult>} work - The statements of the call.
   * @returns {Promise<TResult | null>} What `work` resolved with, or `null` without time left.
   */
  private within<TResult>(
    window: PurgeWindow,
    options: TransactionOptions,
    cutShort: 'fail' | 'skip',
    work: (db: TransactionDatabase) => Promise<TResult>,
  ): Promise<TResult | null> {
    if (this.stalled || this.isOver(window)) {
      return Promise.resolve(null);
    }
    return new Promise<TResult | null>((resolve, reject) => {
      const attempt: { call?: Promise<TResult | null> } = {};
      const race: {
        abandoned: boolean;
        inFlight: boolean;
        timer?: ReturnType<typeof setTimeout>;
      } = { abandoned: false, inFlight: false };
      const listeners: { abandon: () => void } = { abandon: (): void => undefined };
      const stopRace = (): void => {
        clearTimeout(race.timer);
        window.signal.removeEventListener('abort', listeners.abandon);
      };
      listeners.abandon = (): void => {
        if (!race.abandoned) {
          race.abandoned = true;
          stopRace();
          if (attempt.call !== undefined) {
            this.holdAbandoned(attempt.call);
          }
          if (race.inFlight && cutShort === 'fail') {
            reject(new Error('The deadline of the purge came while a delete was in flight.'));
          } else {
            resolve(null);
          }
        }
      };
      const abandon = listeners.abandon;
      race.timer = setTimeout(abandon, Math.max(0, window.deadline - this.now()));
      window.signal.addEventListener('abort', abandon, { once: true });
      const stopped = (): boolean => race.abandoned || this.isOver(window);
      attempt.call = this.system.run(async ({ db }): Promise<TResult | null> => {
        if (stopped()) {
          return null;
        }
        const timeout: string = timeoutOf(window.deadline - this.now());
        await db.execute(
          sql`select set_config('statement_timeout', ${timeout}, true),
                       set_config('idle_in_transaction_session_timeout', ${timeout}, true)`,
        );
        // The settings took a round trip: the deadline or the abort may have come meanwhile.
        if (stopped()) {
          return null;
        }
        race.inFlight = true;
        return work(db);
      }, options);
      attempt.call.then(
        (value: TResult | null): void => {
          stopRace();
          if (!race.abandoned) {
            resolve(value);
          }
        },
        (error: unknown): void => {
          stopRace();
          // A transaction the call gave up on can only fail on its own; nobody waits for it.
          if (!race.abandoned) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
      );
    });
  }

  /**
   * Method holdAbandoned
   *
   * @description
   * Keeps a call the purge gave up on until its transaction ends, whatever its outcome, then lets the
   * purge check connections out again.
   *
   * @param {Promise<unknown>} call - The call given up on.
   * @returns {void}
   */
  private holdAbandoned(call: Promise<unknown>): void {
    const settled: Promise<void> = call.then(
      (): void => undefined,
      (): void => undefined,
    );
    this.abandonedCall = settled;
    void settled.then((): void => {
      if (this.abandonedCall === settled) {
        this.abandonedCall = null;
      }
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
