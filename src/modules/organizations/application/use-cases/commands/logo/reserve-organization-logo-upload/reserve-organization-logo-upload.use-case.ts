import { toOrganizationLogoRefusal } from '../../../../mappers/refusals/organization-logo-refusal.mapper.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationLogoUnitOfWork } from '../../../../ports/outbound/transactions/logo/organization-logo-unit-of-work.port.js';
import { requireAuthorizedLogo } from '../../../../services/logo/authorized-organization-logo.service.js';
import type { ReserveOrganizationLogoUploadInput } from './reserve-organization-logo-upload.input.js';
import type { ReserveOrganizationLogoUploadOutput } from './reserve-organization-logo-upload.output.js';

/** Reserves an immutable owner upload, replaying the original allocation when requested. */
export class ReserveOrganizationLogoUpload {
  // #region Constructor
  /** Binds the tenant transaction, owner clock and configured reservation lifetime. */
  public constructor(
    private readonly work: OrganizationLogoUnitOfWork,
    private readonly clock: Clock,
    private readonly lifetimeMs: number,
  ) {
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0)
      throw new RangeError('Invalid logo reservation lifetime.');
  }
  // #endregion

  // #region Methods
  /** Requires the actor's currently locked membership even on an idempotent replay. */
  public async execute(
    input: ReserveOrganizationLogoUploadInput,
  ): Promise<ReserveOrganizationLogoUploadOutput> {
    try {
      return await this.work.run(async (store) => {
        const logo = await requireAuthorizedLogo(store, input);
        const declaration = { contentType: input.contentType, sizeBytes: input.sizeBytes };
        if (input.idempotencyKey !== undefined) {
          const prior = await store.findByKey(
            input.organizationId,
            input.actorUserId,
            input.idempotencyKey,
          );
          if (prior !== null) {
            return prior.replay(
              {
                organizationId: input.organizationId,
                uploaderUserId: input.actorUserId,
                uploadId: prior.snapshot.uploadId,
              },
              declaration,
            );
          }
        }
        const now = this.clock.now();
        const uploadId = await store.newUploadId();
        const reservation = logo.reserve(
          { organizationId: input.organizationId, uploaderUserId: input.actorUserId, uploadId },
          declaration,
          now,
          new Date(now.getTime() + this.lifetimeMs),
        );
        await store.insertReservation(reservation, input.idempotencyKey);
        return {
          uploadId: reservation.snapshot.uploadId,
          expiresAt: reservation.snapshot.expiresAt,
        };
      });
    } catch (error) {
      throw toOrganizationLogoRefusal(error);
    }
  }
  // #endregion
}
