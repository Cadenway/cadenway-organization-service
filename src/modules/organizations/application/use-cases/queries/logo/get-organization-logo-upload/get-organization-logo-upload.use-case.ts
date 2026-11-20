import { OrganizationLogoError } from '../../../../../domain/errors/logo/organization-logo.error.js';
import { toOrganizationLogoRefusal } from '../../../../mappers/refusals/organization-logo-refusal.mapper.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationLogoUnitOfWork } from '../../../../ports/outbound/transactions/logo/organization-logo-unit-of-work.port.js';
import { requireAuthorizedLogo } from '../../../../services/logo/authorized-organization-logo.service.js';
import type { GetOrganizationLogoUploadInput } from './get-organization-logo-upload.input.js';
import type { GetOrganizationLogoUploadOutput } from './get-organization-logo-upload.output.js';

/** Reads the reservation only while the owner and uploader are still authorized. */
export class GetOrganizationLogoUpload {
  // #region Constructor
  /** Binds the operation to its transaction dependencies. */
  public constructor(
    private readonly work: OrganizationLogoUnitOfWork,
    private readonly clock: Clock,
  ) {}
  // #endregion

  // #region Methods
  /** Executes the operation within its owner transaction. */
  public async execute(
    input: GetOrganizationLogoUploadInput,
  ): Promise<GetOrganizationLogoUploadOutput> {
    try {
      return await this.work.run(async (store) => {
        const logo = await requireAuthorizedLogo(store, input);
        const reservation = await store.lockReservation(
          input.organizationId,
          input.actorUserId,
          input.uploadId,
        );
        if (reservation === null) throw new OrganizationLogoError('not-found');
        const state = reservation.read(
          {
            organizationId: input.organizationId,
            uploaderUserId: input.actorUserId,
            uploadId: input.uploadId,
          },
          logo.snapshot.generation,
          this.clock.now(),
        );
        return {
          uploadId: reservation.snapshot.uploadId,
          state,
          expiresAt: reservation.snapshot.expiresAt,
        };
      });
    } catch (error) {
      throw toOrganizationLogoRefusal(error);
    }
  }
  // #endregion
}
