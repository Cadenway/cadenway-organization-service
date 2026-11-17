import type { DirectoryUser } from '../../../../../domain/aggregates/directory-user/directory-user.aggregate.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { ProjectProfileUpdateInput } from './project-profile-update.input.js';

/**
 * Class ProjectProfileUpdate
 *
 * @description
 * Applies `user.profile-updated.v1` to the user directory, as `ProjectUserSignUp` applies the
 * sign-up: locked entry, applied by version, idempotent. The member list shows the new name at once
 * ("Vos collègues verront les changements tout de suite.").
 */
export class ProjectProfileUpdate {
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
   * Takes the ports of the projection.
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
   * Applies the event.
   *
   * @param {ProjectProfileUpdateInput} input - The event.
   * @returns {Promise<void>} Resolves once applied, or at once when it was applied already.
   */
  public async execute(input: ProjectProfileUpdateInput): Promise<void> {
    await this.unitOfWork.runAcrossOrganizations(
      async (store: OrganizationsStore): Promise<void> => {
        const entry: DirectoryUser = await store.directory.lock(input.userId);
        const applied: DirectoryUser = entry.applyProfileUpdate(input.version, input.name);
        if (applied !== entry) {
          await store.directory.save(applied);
        }
      },
    );
  }
  // #endregion
}
