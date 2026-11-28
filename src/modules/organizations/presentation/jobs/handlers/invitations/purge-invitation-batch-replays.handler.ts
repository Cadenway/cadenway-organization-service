import type { Job, JobScheduler, JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';

import { InvitationBatchReplayPurgeCutShortError } from '../../../../application/models/invitations/invitation-batch-replay-purge-cut-short.model.js';

/** The most expired replay records one delete removes. */
export const INVITATION_BATCH_REPLAY_PURGE_LIMIT: number = 500;

/**
 * Constant INVITATION_BATCH_REPLAY_PURGE_BUDGET_MS
 *
 * @description
 * How long a tick keeps deleting full batches: under the 8 s shutdown timeout of the job runtime,
 * so a deploy never fails a tick that is still purging.
 *
 * @type {number}
 */
export const INVITATION_BATCH_REPLAY_PURGE_BUDGET_MS: number = 5_000;

/** The end of the budget kept for the read of the backlog, never given to a delete. */
const BACKLOG_READ_RESERVE_MS: number = 500;

/**
 * Constant MIN_DELETE_WINDOW_MS
 *
 * @description
 * The least time left for which a tick starts another delete. Below it, the tick ends on its
 * budget as normal: a delete started with almost no time left would be cut short in its checkout
 * or its setup by the deadline alone, and fail a healthy tick.
 *
 * @type {number}
 */
const MIN_DELETE_WINDOW_MS: number = 250;

/**
 * Interface ExpiredInvitationBatchReplayPurge
 *
 * @description
 * What a tick needs of the store of the expired replay records.
 */
export interface ExpiredInvitationBatchReplayPurge {
  // #region Properties
  /**
   * Property stalled
   *
   * @description
   * Whether a call given up on by an earlier tick has not settled yet, possibly holding or waiting
   * for a pooled connection.
   *
   * @type {boolean}
   * @readonly
   */
  readonly stalled: boolean;
  // #endregion

  // #region Methods
  /**
   * Method purge
   *
   * @description
   * Deletes at most `limit` expired records in one transaction over by `window.deadline`, on the
   * same clock as the handler's.
   *
   * @param {number} limit - The most rows to delete.
   * @param {{ readonly deadline: number; readonly signal: AbortSignal }} window - The absolute
   * deadline and the abort signal of the job.
   * @returns {Promise<number | null>} How many were deleted, or `null` when the deadline or the
   * abort came before the call started.
   * @throws {InvitationBatchReplayPurgeCutShortError} When they came once it had started.
   */
  purge(
    limit: number,
    window: { readonly deadline: number; readonly signal: AbortSignal },
  ): Promise<number | null>;

  /**
   * Method oldestExpiredAgeSeconds
   *
   * @description
   * How long ago the oldest record still in the table expired, read by `window.deadline`.
   *
   * @param {{ readonly deadline: number; readonly signal: AbortSignal }} window - The absolute
   * deadline and the abort signal of the job.
   * @returns {Promise<number | null>} The age in seconds, or `null` without an expired record or
   * without time left.
   */
  oldestExpiredAgeSeconds(window: {
    readonly deadline: number;
    readonly signal: AbortSignal;
  }): Promise<number | null>;
  // #endregion
}

/**
 * Class PurgeInvitationBatchReplaysHandler
 *
 * @description
 * Registers the durable recurring purge of the expired replay records of keyed invitation batches
 * and runs it as a system job each minute: bounded deletes of at most
 * `INVITATION_BATCH_REPLAY_PURGE_LIMIT` rows, one after the other, until a delete removes fewer
 * (the backlog is drained) or `INVITATION_BATCH_REPLAY_PURGE_BUDGET_MS` has passed. Each delete
 * gets the absolute deadline of the tick, less the reserve of the backlog read, and the job's
 * signal, and a delete starts only with `MIN_DELETE_WINDOW_MS` left, so the tick never outlasts its
 * budget, and the backlog is read only with time left. A tick that stops on its budget, before
 * another delete, ends normally: it logs, at `warn`, how many rows it deleted and how old the
 * oldest expired row still is (`null` when there was no time to read it), then leaves the rest to
 * the next tick. A delete the deadline or the abort cut short once started (in its checkout, its
 * setup, its delete, its commit or its rollback) made no progress: the tick logs, at `error`, the
 * phase, what cut it short, the rows deleted before and the backlog, then fails with the store's
 * `InvitationBatchReplayPurgeCutShortError`, so the queue retries it with its backoff, as any
 * other failed tick. The store destroys the connection of a call it gives up on, so that call
 * settles at once and the retry runs. As a fallback, a tick that still finds a call of an earlier
 * tick running (one waiting for a pooled connection) skips at once, logging it at `warn`, so the
 * purge never holds more than one connection.
 */
export class PurgeInvitationBatchReplaysHandler implements OnApplicationBootstrap {
  // #region Properties
  /** Logger of the job, routed to the JSON logs of the kit; it writes counts only. */
  private readonly logger: Logger = new Logger(PurgeInvitationBatchReplaysHandler.name);
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Binds the recurring system job to its bounded purge.
   *
   * @param {JobWorkerRegistry} workers - The workers of the queues.
   * @param {JobScheduler} scheduler - The recurring schedules.
   * @param {ExpiredInvitationBatchReplayPurge} expired - The store of the expired records.
   * @param {string} queue - The queue of the job.
   * @param {() => number} now - The monotonic clock of the budget, in milliseconds, the store's
   * own: a wall-clock step never stretches nor cuts a tick.
   * @constructor
   */
  public constructor(
    private readonly workers: JobWorkerRegistry,
    private readonly scheduler: JobScheduler,
    private readonly expired: ExpiredInvitationBatchReplayPurge,
    private readonly queue: string,
    private readonly now: () => number = (): number => performance.now(),
  ) {}
  // #endregion

  // #region Methods
  /**
   * Method onApplicationBootstrap
   *
   * @description
   * Registers the same UTC schedule on every replica and starts consuming it.
   *
   * @returns {Promise<void>} Resolves once registered.
   */
  public async onApplicationBootstrap(): Promise<void> {
    await this.scheduler.schedule(this.queue, '* * * * *', { key: 'minutely', timeZone: 'UTC' });
    await this.workers.work(this.queue, (job: Job) => this.handle(job));
  }

  /**
   * Method handle
   *
   * @description
   * Runs bounded purges for a system job until the backlog is drained or the budget is spent.
   *
   * @param {Pick<Job, 'organizationId' | 'signal'>} job - The job.
   * @returns {Promise<void>} Resolves once the last purge committed or the budget is spent.
   * @throws {Error} For a job of an organization, or once the job is aborted.
   * @throws {InvitationBatchReplayPurgeCutShortError} When a delete was cut short once started.
   */
  public async handle(job: Pick<Job, 'organizationId' | 'signal'>): Promise<void> {
    if (job.organizationId !== null) {
      throw new Error('The invitation batch replay purge requires a system job.');
    }
    if (this.expired.stalled) {
      // A call an earlier tick gave up on has not settled: never a second connection meanwhile.
      this.logger.warn(
        { skippedTicks: 1 },
        'invitation batch replay purge skipped while an abandoned call still runs',
      );
      return;
    }
    const deadline: number = this.now() + INVITATION_BATCH_REPLAY_PURGE_BUDGET_MS;
    const deletes = { deadline: deadline - BACKLOG_READ_RESERVE_MS, signal: job.signal };
    let deleted: number = 0;
    while (deletes.deadline - this.now() >= MIN_DELETE_WINDOW_MS) {
      job.signal.throwIfAborted();
      const last: number | null = await this.cutShortReported(
        this.expired.purge(INVITATION_BATCH_REPLAY_PURGE_LIMIT, deletes),
        { deleted, deadline, signal: job.signal },
      );
      if (last === null) {
        break;
      }
      deleted += last;
      if (last < INVITATION_BATCH_REPLAY_PURGE_LIMIT) {
        return;
      }
    }
    this.logger.warn(
      { deleted, oldestExpiredAgeSeconds: await this.backlog(deadline, job.signal) },
      'invitation batch replay purge stopped on its budget with expired records left',
    );
  }

  /**
   * Method cutShortReported
   *
   * @description
   * Passes the outcome of a delete through, logging, at `error`, a delete cut short once started,
   * with its phase, what cut it short, the rows the tick deleted before and its backlog, before the
   * error fails the tick.
   *
   * @param {Promise<number | null>} purge - The delete.
   * @param {{ readonly deleted: number; readonly deadline: number; readonly signal: AbortSignal }}
   * tick - The rows deleted so far, the end of the budget and the abort signal of the job.
   * @returns {Promise<number | null>} What the delete answered.
   * @throws {InvitationBatchReplayPurgeCutShortError} Again, once logged.
   */
  private async cutShortReported(
    purge: Promise<number | null>,
    tick: { readonly deleted: number; readonly deadline: number; readonly signal: AbortSignal },
  ): Promise<number | null> {
    try {
      return await purge;
    } catch (error: unknown) {
      if (error instanceof InvitationBatchReplayPurgeCutShortError) {
        this.logger.error(
          {
            phase: error.phase,
            trigger: error.trigger,
            deleted: tick.deleted,
            oldestExpiredAgeSeconds: await this.backlog(tick.deadline, tick.signal),
          },
          'invitation batch replay purge cut short with no progress, the tick fails for a retry',
        );
      }
      throw error;
    }
  }

  /**
   * Method backlog
   *
   * @description
   * The age of the oldest expired record left, read only while the budget of the tick still has
   * time for it and the job runs.
   *
   * @param {number} deadline - The end of the budget, on `now`.
   * @param {AbortSignal} signal - The abort signal of the job.
   * @returns {Promise<number | null>} The age in seconds, or `null` when it was not read or there
   * is none.
   */
  private async backlog(deadline: number, signal: AbortSignal): Promise<number | null> {
    return deadline - this.now() > 0 && !signal.aborted
      ? this.expired.oldestExpiredAgeSeconds({ deadline, signal })
      : null;
  }
  // #endregion
}
