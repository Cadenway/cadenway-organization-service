import type { Job, JobScheduler, JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import type { OnApplicationBootstrap } from '@nestjs/common';

/** The most expired replay records one tick deletes. */
export const INVITATION_BATCH_REPLAY_PURGE_LIMIT: number = 500;

/**
 * Class PurgeInvitationBatchReplaysHandler
 *
 * @description
 * Registers the durable recurring purge of the expired replay records of keyed invitation batches
 * and runs it as a system job: each minute, one bounded delete of at most
 * `INVITATION_BATCH_REPLAY_PURGE_LIMIT` rows. A tick that leaves rows behind lets the next one
 * continue; a failed tick is retried by the queue.
 */
export class PurgeInvitationBatchReplaysHandler implements OnApplicationBootstrap {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Binds the recurring system job to its bounded purge.
   *
   * @param {JobWorkerRegistry} workers - The workers of the queues.
   * @param {JobScheduler} scheduler - The recurring schedules.
   * @param {(limit: number) => Promise<number>} purge - Deletes at most `limit` expired records.
   * @param {string} queue - The queue of the job.
   * @constructor
   */
  public constructor(
    private readonly workers: JobWorkerRegistry,
    private readonly scheduler: JobScheduler,
    private readonly purge: (limit: number) => Promise<number>,
    private readonly queue: string,
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
   * Runs one bounded purge for a system job.
   *
   * @param {Pick<Job, 'organizationId' | 'signal'>} job - The job.
   * @returns {Promise<void>} Resolves once the purge committed.
   * @throws {Error} For a job of an organization.
   */
  public async handle(job: Pick<Job, 'organizationId' | 'signal'>): Promise<void> {
    if (job.organizationId !== null) {
      throw new Error('The invitation batch replay purge requires a system job.');
    }
    job.signal.throwIfAborted();
    await this.purge(INVITATION_BATCH_REPLAY_PURGE_LIMIT);
  }
  // #endregion
}
