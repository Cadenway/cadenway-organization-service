import type { JobQueueDeclaration } from '@cadenway/nest-jobs/provisioning';

/** System-only queue that expires pending logo upload reservations. */
export const EXPIRE_ORGANIZATION_LOGO_UPLOADS_QUEUE: string = 'organization.expire-logo-uploads';

/** Shared by the migrator and the running scheduler and worker. */
export const jobQueues: readonly JobQueueDeclaration[] = [
  {
    name: EXPIRE_ORGANIZATION_LOGO_UPLOADS_QUEUE,
    expireInSeconds: 60,
  },
];
