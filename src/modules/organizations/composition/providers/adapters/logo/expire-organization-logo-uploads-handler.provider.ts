import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { JobScheduler, JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import type { FactoryProvider } from '@nestjs/common';

import { EXPIRE_ORGANIZATION_LOGO_UPLOADS_QUEUE } from '../../../../../../config/job-queues.js';
import { AbandonOrganizationLogoUpload } from '../../../../application/use-cases/commands/logo/abandon-organization-logo-upload/abandon-organization-logo-upload.use-case.js';
import { ExpiredOrganizationLogoReservations } from '../../../../infrastructure/persistence/drizzle/repositories/logo/expired-organization-logo-reservations.repository.js';
import { ExpireOrganizationLogoUploadsHandler } from '../../../../presentation/jobs/handlers/logo/expire-organization-logo-uploads.handler.js';

/** Binds the recurring system scan to the tenant-scoped expiry operation. */
export const expireOrganizationLogoUploadsHandlerProvider: FactoryProvider<ExpireOrganizationLogoUploadsHandler> =
  {
    provide: ExpireOrganizationLogoUploadsHandler,
    inject: [
      JobWorkerRegistry,
      JobScheduler,
      SystemTransactionRunner,
      AbandonOrganizationLogoUpload,
    ],
    useFactory: (
      workers: JobWorkerRegistry,
      scheduler: JobScheduler,
      system: SystemTransactionRunner,
      abandon: AbandonOrganizationLogoUpload,
    ): ExpireOrganizationLogoUploadsHandler => {
      const expired = new ExpiredOrganizationLogoReservations(system);
      return new ExpireOrganizationLogoUploadsHandler(
        workers,
        scheduler,
        () => expired.list(),
        abandon,
        EXPIRE_ORGANIZATION_LOGO_UPLOADS_QUEUE,
      );
    },
  };
