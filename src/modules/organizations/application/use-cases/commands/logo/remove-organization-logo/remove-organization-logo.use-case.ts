import { toOrganizationLogoRefusal } from '../../../../mappers/refusals/organization-logo-refusal.mapper.js';
import type { OrganizationLogoUnitOfWork } from '../../../../ports/outbound/transactions/logo/organization-logo-unit-of-work.port.js';
import { requireAuthorizedLogo } from '../../../../services/logo/authorized-organization-logo.service.js';
import type { RemoveOrganizationLogoInput } from './remove-organization-logo.input.js';
import type { RemoveOrganizationLogoOutput } from './remove-organization-logo.output.js';

/** Removes the active reference and fences older pending reservations. */
export class RemoveOrganizationLogo {
  // #region Constructor
  /** Binds the operation to its transaction dependencies. */
  public constructor(private readonly work: OrganizationLogoUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Executes the operation within its owner transaction. */
  public async execute(input: RemoveOrganizationLogoInput): Promise<RemoveOrganizationLogoOutput> {
    try {
      return await this.work.run(async (store) => {
        const logo = await requireAuthorizedLogo(store, input);
        const result = logo.remove(input.actorUserId, input.expectedVersion);
        await store.saveLogo(result.logo);
        if (result.event !== null) await store.appendLogoChanged(result.event);
        return { version: result.logo.snapshot.profileVersion };
      });
    } catch (error) {
      throw toOrganizationLogoRefusal(error);
    }
  }
  // #endregion
}
