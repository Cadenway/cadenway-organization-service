import type { DirectoryUser } from '../../../../../domain/aggregates/directory-user/directory-user.aggregate.js';
import type { EmailAddress } from '../../../../../domain/value-objects/email/email-address.value-object.js';
import type { Page } from '../../../../models/pagination/page.model.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { VerifiedEmailAuthority } from '../../../../ports/outbound/identity/invitations/verified-email-authority.port.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { ReceivedInvitationView } from '../../../../projections/invitations/received-invitation-view.projection.js';
import type { ListReceivedInvitationsInput } from './list-received-invitations.input.js';

/**
 * Class ListReceivedInvitations
 *
 * @description
 * Lists the pending invitations, not expired, addressed to the actor's current verified address
 * from identity-service, from every organization, the most recently sent first
 * (`GET /internal/v1/users/{userId}/invitations`). A read across organizations: it runs in a
 * read-only system transaction whose queries filter on the actor and on that address (a bounded
 * exception of `MODULE.md`, decision 9 of P2b). Without a verified address yet, the list is empty;
 * a `userId` other than the actor answers `user-not-found`.
 */
export class ListReceivedInvitations {
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

  /**
   * Property clock
   *
   * @description
   * The instant before which the listed invitations expire.
   *
   * @type {Clock}
   * @readonly
   */
  private readonly clock: Clock;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the ports of the list.
   *
   * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
   * @param {Clock} clock - The time of the list.
   * @param {VerifiedEmailAuthority} verifiedEmails - The current verified account address.
   * @constructor
   */
  public constructor(
    unitOfWork: OrganizationsUnitOfWork,
    clock: Clock,
    private readonly verifiedEmails: VerifiedEmailAuthority,
  ) {
    this.unitOfWork = unitOfWork;
    this.clock = clock;
  }
  // #endregion

  // #region Methods
  /**
   * Method execute
   *
   * @description
   * Lists one page.
   *
   * @param {ListReceivedInvitationsInput} input - The actor, the account of the path and the page.
   * @returns {Promise<Page<ReceivedInvitationView>>} The page.
   * @throws {OrganizationRefusal} `user-not-found`.
   */
  public async execute(input: ListReceivedInvitationsInput): Promise<Page<ReceivedInvitationView>> {
    if (input.userId !== input.actorUserId) {
      throw new OrganizationRefusal({ reason: 'user-not-found' });
    }
    const currentEmail: EmailAddress | null = await this.verifiedEmails.find(input.actorUserId);
    const now: Date = this.clock.now();
    return this.unitOfWork.runAcrossOrganizations(
      async (store: OrganizationsStore): Promise<Page<ReceivedInvitationView>> => {
        const user: DirectoryUser | null = await store.directory.find(input.actorUserId);
        if (user === null || user.isDeleted || currentEmail === null) {
          return { items: [], next: null };
        }
        return store.invitations.listReceived(currentEmail, now, input.after, input.limit);
      },
      { readOnly: true },
    );
  }
  // #endregion
}
