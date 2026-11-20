import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationLogoUnitOfWork } from '../../../../ports/outbound/transactions/logo/organization-logo-unit-of-work.port.js';
import type { AbandonOrganizationLogoUploadInput } from './abandon-organization-logo-upload.input.js';
import type { AbandonOrganizationLogoUploadOutput } from './abandon-organization-logo-upload.output.js';

/** Records an expired or superseded upload decision in the owner transaction. */
export class AbandonOrganizationLogoUpload {
  // #region Constructor
  /** Binds the operation to its transaction dependencies. */
  public constructor(
    private readonly work: OrganizationLogoUnitOfWork,
    private readonly clock: Clock,
  ) {}
  // #endregion

  // #region Methods
  /** Executes the operation within its owner transaction. */
  public execute(
    input: AbandonOrganizationLogoUploadInput,
  ): Promise<AbandonOrganizationLogoUploadOutput> {
    return this.work.runForCleanup(input.organizationId, async (store) => {
      const logo = await store.lockLogo(input.organizationId);
      if (logo === null) return { abandoned: false };
      const reservation = await store.lockReservation(
        input.organizationId,
        input.uploaderUserId,
        input.uploadId,
      );
      if (reservation === null) return { abandoned: false };
      const result = reservation.abandon(logo.snapshot.generation, this.clock.now());
      if (result.event === null) return { abandoned: false };
      await store.saveReservation(result.reservation);
      await store.appendUploadAbandoned(result.event);
      return { abandoned: true };
    });
  }
  // #endregion
}
