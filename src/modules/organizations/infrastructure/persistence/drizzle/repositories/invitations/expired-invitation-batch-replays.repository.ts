import type { TransactionDatabase, TransactionOptions } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { InvitationBatchReplayPurgeCutShortError } from '../../../../../application/models/invitations/invitation-batch-replay-purge-cut-short.model.js';
import { invitationBatchReplays } from '../../schemas/invitations/invitation-batch-replay.schema.js';
import type { DiscardableSystemTransactions } from '../../transactions/invitations/discardable-system.transaction.js';
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
 * Constant SERVER_TIMEOUT_GRACE_MS
 *
 * @description
 * How much longer than the time left the server's own timeouts of a purge transaction run. The
 * call gives up, and discards its connection, at its deadline on the client: the server's timeouts
 * are the backstop for the locks a discarded transaction may still hold, and the grace lets the
 * client's deadline always come first, so a stall is always reported with its phase rather than as
 * the server's cancellation.
 *
 * @type {number}
 */
const SERVER_TIMEOUT_GRACE_MS: number = 1_000;

/**
 * Function timeoutOf
 *
 * @description
 * The `statement_timeout` a transaction of the purge sets for itself: the time left to its tick
 * plus `SERVER_TIMEOUT_GRACE_MS`, in whole milliseconds and 1 at least (0 would disable it).
 *
 * @param {number} timeoutMs - The time left, in milliseconds.
 * @returns {string} The setting.
 */
function timeoutOf(timeoutMs: number): string {
  return `${String(Math.max(1, Math.floor(timeoutMs + SERVER_TIMEOUT_GRACE_MS)))}ms`;
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
   * The instant, in milliseconds on the monotonic clock of the repository (`performance.now()`
   * by default), the call must be over by.
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
 * job's abort signal: the whole call races them (`within`), from the wait for a pooled connection
 * to the commit, so a purge never outlasts its tick. When the deadline or the abort wins while the
 * call runs, its connection is destroyed on the client side, so the call given up on settles at
 * once, even on a connection stuck at the socket level, and a purge rejects with an
 * `InvitationBatchReplayPurgeCutShortError` naming the phase it stood in: its outcome is
 * unconfirmed, so its tick must fail and be retried. The server caps the statements too, a little later
 * (`SERVER_TIMEOUT_GRACE_MS`), as the backstop of the locks a discarded transaction may hold.
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
   * Its connection is destroyed when it is given up on, so it normally settles at once; only a
   * call still waiting for a pooled connection stays until the pool hands one over (bounded by the
   * pool's connection timeout) and gives it back unused.
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
   * Binds the purge to system transactions because it spans organizations, on connections it can
   * discard at its deadline. The application model of the error a cut-short call rejects with is
   * given by the composition, since an adapter may only name it as a type.
   *
   * @param {DiscardableSystemTransactions} system - The discardable system transactions.
   * @param {(phase: InvitationBatchReplayPurgeCutShortError['phase'], trigger: InvitationBatchReplayPurgeCutShortError['trigger']) => InvitationBatchReplayPurgeCutShortError} cutShort -
   * Builds the error of a call cut short once started.
   * @param {() => number} now - The monotonic clock of the deadlines, in milliseconds.
   * @constructor
   */
  public constructor(
    private readonly system: DiscardableSystemTransactions,
    private readonly cutShort: (
      phase: InvitationBatchReplayPurgeCutShortError['phase'],
      trigger: InvitationBatchReplayPurgeCutShortError['trigger'],
    ) => InvitationBatchReplayPurgeCutShortError,
    private readonly now: () => number = (): number => performance.now(),
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
   * @returns {Promise<number | null>} How many rows it deleted, or `null` when the deadline or the
   * abort had come before the call started (or a call given up on earlier had not settled by then).
   * @throws {InvitationBatchReplayPurgeCutShortError} When the deadline or the abort came once the
   * call had started, with the phase it stood in.
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
   * @returns {Promise<number | null>} The age, or `null` when no expired record remains or the
   * deadline or the abort came first. A call given up on earlier is waited for, up to the deadline,
   * so a tick that was just cut short still reads its backlog.
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
   * to the commit. A call given up on earlier is first waited for, up to the deadline or the abort,
   * so that at most one database call of the purge is in flight. The call answers `null` when the
   * deadline or the abort came before it started: the normal end of a tick. Once started, the
   * whole transaction races them: if either comes first, the call never waits for the transaction,
   * whose connection is discarded at once (destroyed on the client side, so its pending statement
   * rejects and the transaction settles, however stuck the socket is), and which runs no statement
   * of its own past that point (it checks before each one). Under `cutShort: 'fail'` the call then
   * rejects with an `InvitationBatchReplayPurgeCutShortError` naming the phase it stood in
   * (`checkout`, `setup`, `delete`, `commit` or `rollback`): it is unconfirmed (a commit may have
   * taken effect, any other phase made no progress), and the job must fail so its queue retries
   * it, which is safe since a delete of expired rows is idempotent. Under `skip` (a read) it
   * answers `null`. The first statement sets `statement_timeout` and
   * `idle_in_transaction_session_timeout` to the time left plus `SERVER_TIMEOUT_GRACE_MS`, the
   * server's backstop for the locks a discarded transaction may hold until it notices.
   *
   * @param {PurgeWindow} window - The deadline and the abort signal.
   * @param {TransactionOptions} options - How the transaction is opened.
   * @param {'fail' | 'skip'} cutShort - What a deadline or an abort that comes once the call
   * started does: `fail` rejects with the phase (a delete), `skip` answers `null` (a read).
   * @param {(db: TransactionDatabase) => Promise<TResult>} work - The statements of the call.
   * @returns {Promise<TResult | null>} What `work` resolved with, or `null` as described.
   * @throws {InvitationBatchReplayPurgeCutShortError} Under `fail`, when cut short once started.
   */
  private async within<TResult>(
    window: PurgeWindow,
    options: TransactionOptions,
    cutShort: 'fail' | 'skip',
    work: (db: TransactionDatabase) => Promise<TResult>,
  ): Promise<TResult | null> {
    if (this.abandonedCall !== null) {
      await this.settledWithin(this.abandonedCall, window);
    }
    if (this.stalled || this.isOver(window)) {
      return null;
    }
    return new Promise<TResult | null>((resolve, reject) => {
      const attempt: { call?: Promise<TResult | null> } = {};
      const race: {
        abandoned: boolean;
        phase: InvitationBatchReplayPurgeCutShortError['phase'];
        timer?: ReturnType<typeof setTimeout>;
      } = { abandoned: false, phase: 'checkout' };
      const discard: AbortController = new AbortController();
      const listeners: { abandon: () => void } = { abandon: (): void => undefined };
      const stopRace = (): void => {
        clearTimeout(race.timer);
        window.signal.removeEventListener('abort', listeners.abandon);
      };
      const cutShortError = (): InvitationBatchReplayPurgeCutShortError =>
        this.cutShort(race.phase, window.signal.aborted ? 'abort' : 'deadline');
      listeners.abandon = (): void => {
        if (!race.abandoned) {
          race.abandoned = true;
          stopRace();
          if (attempt.call !== undefined) {
            this.holdAbandoned(attempt.call);
          }
          // Destroys the connection of a transaction still running, so the call settles at once.
          discard.abort();
          if (cutShort === 'fail') {
            reject(cutShortError());
          } else {
            resolve(null);
          }
        }
      };
      const abandon = listeners.abandon;
      race.timer = setTimeout(abandon, Math.max(0, window.deadline - this.now()));
      window.signal.addEventListener('abort', abandon, { once: true });
      // The deadline may pass between the checks of the clock and the timer that enforces it.
      const stop = (): null => {
        if (cutShort === 'fail') {
          throw cutShortError();
        }
        return null;
      };
      const stopped = (): boolean => race.abandoned || this.isOver(window);
      attempt.call = this.system.run(
        async ({ db }): Promise<TResult | null> => {
          if (stopped()) {
            return stop();
          }
          const timeout: string = timeoutOf(window.deadline - this.now());
          await db.execute(
            sql`select set_config('statement_timeout', ${timeout}, true),
                       set_config('idle_in_transaction_session_timeout', ${timeout}, true)`,
          );
          // The settings took a round trip: the deadline or the abort may have come meanwhile.
          if (stopped()) {
            return stop();
          }
          race.phase = 'delete';
          return work(db);
        },
        options,
        discard.signal,
        (phase: 'setup' | 'work' | 'commit' | 'rollback'): void => {
          // `work` begins with the settings of the timeouts, still part of the setup.
          if (phase !== 'work') {
            race.phase = phase;
          }
        },
      );
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
   * Method settledWithin
   *
   * @description
   * Waits for a call given up on to settle, but never past the deadline or the abort of `window`.
   *
   * @param {Promise<void>} call - The call given up on, which never rejects.
   * @param {PurgeWindow} window - The deadline and the abort signal.
   * @returns {Promise<void>} Resolves once the call settled or the wait is over.
   */
  private async settledWithin(call: Promise<void>, window: PurgeWindow): Promise<void> {
    if (this.isOver(window)) {
      return;
    }
    const wait: { timer?: ReturnType<typeof setTimeout>; abort?: () => void } = {};
    try {
      await Promise.race([
        call,
        new Promise<void>((resolve) => {
          wait.abort = (): void => {
            resolve();
          };
          wait.timer = setTimeout(wait.abort, Math.max(0, window.deadline - this.now()));
          window.signal.addEventListener('abort', wait.abort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(wait.timer);
      if (wait.abort !== undefined) {
        window.signal.removeEventListener('abort', wait.abort);
      }
    }
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
