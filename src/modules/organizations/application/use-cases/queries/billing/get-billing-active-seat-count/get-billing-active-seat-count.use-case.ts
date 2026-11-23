import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';

/** Reads the current billable seats of the organization selected by the caller. */
export class GetBillingActiveSeatCount {
  // #region Constructor
  /** Binds the query to the verified tenant transaction. */
  public constructor(private readonly work: OrganizationsUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Returns null only when the tenant is missing. */
  public execute(organizationId: string): Promise<number | null> {
    return this.work.runInRequestOrganization(
      (store) => store.organizations.countActiveSeats(organizationId),
      { readOnly: true },
    );
  }
  // #endregion
}
