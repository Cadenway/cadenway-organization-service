import type { DirectoryUser } from '../../../../../domain/aggregates/directory-user/directory-user.aggregate.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { ProjectTwoStepVerificationChangeInput } from './project-two-step-verification-change.input.js';

/**
 * Class ProjectTwoStepVerificationChange
 *
 * @description
 * Applies `user.two-step-verification-changed.v1` to the user directory, as `ProjectProfileUpdate`
 * applies a profile: in the system transaction of the deduplicator, on the locked entry of the
 * account (created empty when no event of it was applied yet), by version, so a redelivery or an
 * older event changes nothing. The member list answers it to the owner and the admins ("Deux
 * étapes").
 */
export class ProjectTwoStepVerificationChange {
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
   * @param {ProjectTwoStepVerificationChangeInput} input - The account, its version and the flag.
   * @returns {Promise<void>} Resolves once applied, or at once when it was applied already.
   */
  public async execute(input: ProjectTwoStepVerificationChangeInput): Promise<void> {
    await this.unitOfWork.runAcrossOrganizations(
      async (store: OrganizationsStore): Promise<void> => {
        const entry: DirectoryUser = await store.directory.lock(input.userId);
        const applied: DirectoryUser = entry.applyTwoStepVerificationChange(
          input.version,
          input.enabled,
        );
        if (applied !== entry) {
          await store.directory.save(applied);
        }
      },
    );
  }
  // #endregion
}
