import type { Job, JobScheduler, JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';

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

/**
 * Interface ExpiredInvitationBatchReplayPurge
 *
 * @description
 * What a tick needs of the store of the expired replay records.
 */
export interface ExpiredInvitationBatchReplayPurge {
  // #region Methods
  /**
   * Method purge
   *
   * @description
   * Deletes at most `limit` expired records in one transaction.
   *
   * @param {number} limit - The most rows to delete.
   * @returns {Promise<number>} How many were deleted.
   */
  purge(limit: number): Promise<number>;

  /**
   * Method oldestExpiredAgeSeconds
   *
   * @description
   * How long ago the oldest record still in the table expired.
   *
   * @returns {Promise<number | null>} The age in seconds, or `null` without an expired record.
   */
  oldestExpiredAgeSeconds(): Promise<number | null>;
  // #endregion
}

/**
 * Class PurgeInvitationBatchReplaysHandler
 *
 * @description
 * Registers the durable recurring purge of the expired replay records of keyed invitation batches
 * and runs it as a system job each minute: bounded deletes of at most
 * `INVITATION_BATCH_REPLAY_PURGE_LIMIT` rows, one after the other, until a delete removes fewer
 * (the backlog is drained) or `INVITATION_BATCH_REPLAY_PURGE_BUDGET_MS` has passed. A tick that
 * stops on its budget logs, at `warn`, how many rows it deleted and how old the oldest expired row
 * still is, then leaves the rest to the next tick; a failed tick is retried by the queue.
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
   * @param {() => number} now - The clock of the budget, in milliseconds.
   * @constructor
   */
  public constructor(
    private readonly workers: JobWorkerRegistry,
    private readonly scheduler: JobScheduler,
    private readonly expired: ExpiredInvitationBatchReplayPurge,
    private readonly queue: string,
    private readonly now: () => number = Date.now,
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
   * @returns {Promise<void>} Resolves once the last purge committed.
   * @throws {Error} For a job of an organization, or once the job is aborted.
   */
  public async handle(job: Pick<Job, 'organizationId' | 'signal'>): Promise<void> {
    if (job.organizationId !== null) {
      throw new Error('The invitation batch replay purge requires a system job.');
    }
    const deadline: number = this.now() + INVITATION_BATCH_REPLAY_PURGE_BUDGET_MS;
    let deleted: number = 0;
    let last: number;
    do {
      job.signal.throwIfAborted();
      last = await this.expired.purge(INVITATION_BATCH_REPLAY_PURGE_LIMIT);
      deleted += last;
    } while (last === INVITATION_BATCH_REPLAY_PURGE_LIMIT && this.now() < deadline);
    if (last === INVITATION_BATCH_REPLAY_PURGE_LIMIT) {
      this.logger.warn(
        { deleted, oldestExpiredAgeSeconds: await this.expired.oldestExpiredAgeSeconds() },
        'invitation batch replay purge stopped on its budget with expired records left',
      );
    }
  }
  // #endregion
}
