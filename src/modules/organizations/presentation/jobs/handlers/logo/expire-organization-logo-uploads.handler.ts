import type { Job, JobScheduler, JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import type { OnApplicationBootstrap } from '@nestjs/common';

import type { AbandonOrganizationLogoUploadInput } from '../../../../application/use-cases/commands/logo/abandon-organization-logo-upload/abandon-organization-logo-upload.input.js';
import type { AbandonOrganizationLogoUpload } from '../../../../application/use-cases/commands/logo/abandon-organization-logo-upload/abandon-organization-logo-upload.use-case.js';

/** Registers the durable recurring sweep and delegates each decision to the owner use case. */
export class ExpireOrganizationLogoUploadsHandler implements OnApplicationBootstrap {
  // #region Constructor
  /** Binds the recurring system job to its candidate reader and owner operation. */
  public constructor(
    private readonly workers: JobWorkerRegistry,
    private readonly scheduler: JobScheduler,
    private readonly listExpired: () => Promise<readonly AbandonOrganizationLogoUploadInput[]>,
    private readonly abandon: Pick<AbandonOrganizationLogoUpload, 'execute'>,
    private readonly queue: string,
  ) {}
  // #endregion

  // #region Methods
  /** Registers the same UTC schedule on every replica and starts consuming it. */
  public async onApplicationBootstrap(): Promise<void> {
    await this.scheduler.schedule(this.queue, '* * * * *', { key: 'minutely', timeZone: 'UTC' });
    await this.workers.work(this.queue, (job: Job) => this.handle(job));
  }

  /** Processes a bounded scan as a system job, allowing failed reservations to be retried. */
  public async handle(job: Pick<Job, 'organizationId' | 'signal'>): Promise<void> {
    if (job.organizationId !== null) throw new Error('Logo upload expiry requires a system job.');
    job.signal.throwIfAborted();

    let failed = 0;
    for (const candidate of await this.listExpired()) {
      job.signal.throwIfAborted();
      try {
        await this.abandon.execute(candidate);
      } catch {
        failed += 1;
      }
    }
    if (failed !== 0)
      throw new Error(`Could not expire ${String(failed)} logo upload reservations.`);
  }
  // #endregion
}
