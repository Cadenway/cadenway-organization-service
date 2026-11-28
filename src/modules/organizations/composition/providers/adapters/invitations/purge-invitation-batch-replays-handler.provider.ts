import { DATABASE_POOL } from '@cadenway/nest-common/database';
import { JobScheduler, JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import type { FactoryProvider } from '@nestjs/common';

import { PURGE_INVITATION_BATCH_REPLAYS_QUEUE } from '../../../../../../config/job-queues.js';
import { ExpiredInvitationBatchReplays } from '../../../../infrastructure/persistence/drizzle/repositories/invitations/expired-invitation-batch-replays.repository.js';
import { DiscardableSystemTransactions } from '../../../../infrastructure/persistence/drizzle/transactions/invitations/discardable-system.transaction.js';
import { PurgeInvitationBatchReplaysHandler } from '../../../../presentation/jobs/handlers/invitations/purge-invitation-batch-replays.handler.js';

/**
 * Binds the recurring system purge to the bounded delete of expired replay records, on system
 * transactions of the service's pool whose connection it can discard at its deadline.
 */
export const purgeInvitationBatchReplaysHandlerProvider: FactoryProvider<PurgeInvitationBatchReplaysHandler> =
  {
    provide: PurgeInvitationBatchReplaysHandler,
    inject: [JobWorkerRegistry, JobScheduler, DATABASE_POOL],
    useFactory: (
      workers: JobWorkerRegistry,
      scheduler: JobScheduler,
      pool: ConstructorParameters<typeof DiscardableSystemTransactions>[0],
    ): PurgeInvitationBatchReplaysHandler => {
      return new PurgeInvitationBatchReplaysHandler(
        workers,
        scheduler,
        new ExpiredInvitationBatchReplays(new DiscardableSystemTransactions(pool)),
        PURGE_INVITATION_BATCH_REPLAYS_QUEUE,
      );
    },
  };
