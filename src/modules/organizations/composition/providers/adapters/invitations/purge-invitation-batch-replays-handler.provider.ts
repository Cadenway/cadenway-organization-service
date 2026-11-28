import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { JobScheduler, JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import type { FactoryProvider } from '@nestjs/common';

import { PURGE_INVITATION_BATCH_REPLAYS_QUEUE } from '../../../../../../config/job-queues.js';
import { ExpiredInvitationBatchReplays } from '../../../../infrastructure/persistence/drizzle/repositories/invitations/expired-invitation-batch-replays.repository.js';
import { PurgeInvitationBatchReplaysHandler } from '../../../../presentation/jobs/handlers/invitations/purge-invitation-batch-replays.handler.js';

/** Binds the recurring system purge to the bounded delete of expired replay records. */
export const purgeInvitationBatchReplaysHandlerProvider: FactoryProvider<PurgeInvitationBatchReplaysHandler> =
  {
    provide: PurgeInvitationBatchReplaysHandler,
    inject: [JobWorkerRegistry, JobScheduler, SystemTransactionRunner],
    useFactory: (
      workers: JobWorkerRegistry,
      scheduler: JobScheduler,
      system: SystemTransactionRunner,
    ): PurgeInvitationBatchReplaysHandler => {
      const expired = new ExpiredInvitationBatchReplays(system);
      return new PurgeInvitationBatchReplaysHandler(
        workers,
        scheduler,
        (limit: number) => expired.purge(limit),
        PURGE_INVITATION_BATCH_REPLAYS_QUEUE,
      );
    },
  };
