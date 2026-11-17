import type { DirectoryUser } from '../../../../../domain/aggregates/directory-user/directory-user.aggregate.js';
import { EmailAddress } from '../../../../../domain/value-objects/email/email-address.value-object.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { ProjectUserSignUpInput } from './project-user-sign-up.input.js';

/**
 * Class ProjectUserSignUp
 *
 * @description
 * Applies `user.signed-up.v1` to the user directory, in the system transaction the deduplicator of
 * the kit opened for the delivery (the event belongs to no organization). The entry is locked, so
 * two events of one account apply one after the other, and the domain applies it by version:
 * a redelivery, or an event older than what the entry holds, changes nothing. Idempotent.
 */
export class ProjectUserSignUp {
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
   * @param {ProjectUserSignUpInput} input - The event.
   * @returns {Promise<void>} Resolves once applied, or at once when it was applied already.
   */
  public async execute(input: ProjectUserSignUpInput): Promise<void> {
    const email: EmailAddress = EmailAddress.parse(input.email);
    await this.unitOfWork.runAcrossOrganizations(
      async (store: OrganizationsStore): Promise<void> => {
        const entry: DirectoryUser = await store.directory.lock(input.userId);
        const applied: DirectoryUser = entry.applySignUp(input.version, email, input.name);
        if (applied !== entry) {
          await store.directory.save(applied);
        }
      },
    );
  }
  // #endregion
}
