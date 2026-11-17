import type { Organization } from '../../../../../domain/aggregates/organization/organization.aggregate.js';
import type { OrganizationDraft } from '../../../../../domain/value-objects/organizations/organization-draft.value-object.js';
import type { Page } from '../../../../models/pagination/page.model.js';
import type { PagePosition } from '../../../../models/pagination/page-position.model.js';
import type { MyOrganizationView } from '../../../../projections/organizations/my-organization-view.projection.js';

/**
 * Interface OrganizationRepository
 *
 * @description
 * The organizations, bound to the transaction of a unit of work. In a tenant transaction it reaches
 * the organization of that transaction only.
 */
export interface OrganizationRepository {
  // #region Methods
  /**
   * Method insert
   *
   * @description
   * Stores a new organization; PostgreSQL assigns its id.
   *
   * @param {OrganizationDraft} draft - The organization to store.
   * @returns {Promise<Organization>} The stored organization, with its id.
   * @throws {SlugTakenError} When another organization uses its address.
   */
  insert(draft: OrganizationDraft): Promise<Organization>;

  /**
   * Method find
   *
   * @description
   * Loads an organization without a lock.
   *
   * @param {string} organizationId - Id of the organization.
   * @returns {Promise<Organization | null>} The organization, or `null`.
   */
  find(organizationId: string): Promise<Organization | null>;

  /**
   * Method findForUpdate
   *
   * @description
   * Loads an organization and locks it until the end of the transaction.
   *
   * @param {string} organizationId - Id of the organization.
   * @returns {Promise<Organization | null>} The organization, or `null`.
   */
  findForUpdate(organizationId: string): Promise<Organization | null>;

  /**
   * Method update
   *
   * @description
   * Writes the profile and the version of an organization locked by `findForUpdate`.
   *
   * @param {Organization} organization - The organization after the change.
   * @returns {Promise<void>} Resolves once written.
   * @throws {SlugTakenError} When another organization uses its new address.
   */
  update(organization: Organization): Promise<void>;

  /**
   * Method listOfUser
   *
   * @description
   * One page of the organizations an account is an active member of, sorted by the search key of
   * their name, then by id. Reads across organizations: only in a system transaction.
   *
   * @param {string} userId - The account.
   * @param {PagePosition | null} after - Where the previous page ended, or `null`.
   * @param {number} limit - Page size.
   * @returns {Promise<Page<MyOrganizationView>>} The page.
   */
  listOfUser(
    userId: string,
    after: PagePosition | null,
    limit: number,
  ): Promise<Page<MyOrganizationView>>;
  // #endregion
}
