import type { DirectoryUser } from '../../../../../domain/aggregates/directory-user/directory-user.aggregate.js';
import { EmailAddress } from '../../../../../domain/value-objects/email/email-address.value-object.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { ProjectEmailVerificationInput } from './project-email-verification.input.js';

/**
 * Class ProjectEmailVerification
 *
 * @description
 * Applies `user.email-verified.v1` to the user directory, as `ProjectUserSignUp` applies the
 * sign-up: locked entry, applied by version, idempotent. From then on the invitations sent to that
 * address can be listed and answered by the account (decision 5 of P2b).
 */
export class ProjectEmailVerification {
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
   * @param {ProjectEmailVerificationInput} input - The event.
   * @returns {Promise<void>} Resolves once applied, or at once when it was applied already.
   */
  public async execute(input: ProjectEmailVerificationInput): Promise<void> {
    const email: EmailAddress = EmailAddress.parse(input.email);
    await this.unitOfWork.runAcrossOrganizations(
      async (store: OrganizationsStore): Promise<void> => {
        const entry: DirectoryUser = await store.directory.lock(input.userId);
        const applied: DirectoryUser = entry.applyEmailVerification(input.version, email);
        if (applied !== entry) {
          await store.directory.save(applied);
        }
      },
    );
  }
  // #endregion
}
