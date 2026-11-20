import { OrganizationLogoError } from '../../../../../domain/errors/logo/organization-logo.error.js';
import { toOrganizationLogoRefusal } from '../../../../mappers/refusals/organization-logo-refusal.mapper.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationLogoUnitOfWork } from '../../../../ports/outbound/transactions/logo/organization-logo-unit-of-work.port.js';
import { requireAuthorizedLogo } from '../../../../services/logo/authorized-organization-logo.service.js';
import type { PublishOrganizationLogoInput } from './publish-organization-logo.input.js';
import type { PublishOrganizationLogoOutput } from './publish-organization-logo.output.js';

/** Publishes the exact owner reservation already prepared by the trusted gateway. */
export class PublishOrganizationLogo {
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
    input: PublishOrganizationLogoInput,
  ): Promise<PublishOrganizationLogoOutput> {
    try {
      return await this.work.run(async (store) => {
        const logo = await requireAuthorizedLogo(store, input);
        const reservation = await store.lockReservation(
          input.organizationId,
          input.actorUserId,
          input.uploadId,
        );
        if (reservation === null) throw new OrganizationLogoError('not-found');
        const binding = {
          organizationId: input.organizationId,
          uploaderUserId: input.actorUserId,
          uploadId: input.uploadId,
        };
        // Only the authenticated gateway invokes this operation after Storage preparation.
        const result = logo.publish(
          reservation,
          binding,
          binding,
          this.clock.now(),
          input.expectedVersion,
        );
        if (result.event !== null) {
          await store.saveLogo(result.logo);
          await store.saveReservation(result.reservation);
          await store.appendLogoChanged(result.event);
        }
        return { version: result.logo.snapshot.profileVersion };
      });
    } catch (error) {
      throw toOrganizationLogoRefusal(error);
    }
  }
  // #endregion
}
