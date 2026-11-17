import type { Page } from '../../../../models/pagination/page.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { MyOrganizationView } from '../../../../projections/organizations/my-organization-view.projection.js';
import type { ListMyOrganizationsInput } from './list-my-organizations.input.js';

/**
 * Class ListMyOrganizations
 *
 * @description
 * Lists the organizations the actor is an active member of (`GET /internal/v1/organizations`, the
 * picker and the switcher), whatever the organization of the token. A read across organizations:
 * it runs in a read-only system transaction whose one query filters on the actor (a bounded
 * exception of `MODULE.md`, decision 9 of P2b).
 */
export class ListMyOrganizations {
  // #region Properties
  /**
   * Property unitOfWork
   *
   * @description
   * The transactions of the module.
   *
   * @type {OrganizationsUnitOfWork}
   * @readonly
   */
  private readonly unitOfWork: OrganizationsUnitOfWork;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the ports of the list.
   *
   * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
   * @constructor
   */
  public constructor(unitOfWork: OrganizationsUnitOfWork) {
    this.unitOfWork = unitOfWork;
  }
  // #endregion

  // #region Methods
  /**
   * Method execute
   *
   * @description
   * Lists one page.
   *
   * @param {ListMyOrganizationsInput} input - The actor and the page.
   * @returns {Promise<Page<MyOrganizationView>>} The page.
   */
  public execute(input: ListMyOrganizationsInput): Promise<Page<MyOrganizationView>> {
    return this.unitOfWork.runAcrossOrganizations(
      (store: OrganizationsStore): Promise<Page<MyOrganizationView>> =>
        store.organizations.listOfUser(input.actorUserId, input.after, input.limit),
      { readOnly: true },
    );
  }
  // #endregion
}
