import type { DirectoryUser } from '../../../../../domain/aggregates/directory-user/directory-user.aggregate.js';
import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import { DeletedOwnerError } from '../../../../../domain/errors/members/deleted-owner.error.js';
import { assertOwnsNoOrganization } from '../../../../../domain/policies/members/account-deletion.policy.js';
import { DeletedOwnerRefusal } from '../../../../models/members/deleted-owner-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { RemoveDeletedUserInput } from './remove-deleted-user.input.js';

/**
 * Class RemoveDeletedUser
 *
 * @description
 * Applies `user.deleted.v1` (decision 9 of P2c): removes every active membership of the account,
 * each with its `member.removed.v1` whose actor is the system, and keeps the account in the user
 * directory as a former member without name or address, so that it shows as « Ancien membre »
 * where it still appears. Its pending invitations stay pending: they belong to their organization,
 * the contract does not withdraw them, and their sender shows as « Ancien membre ».
 *
 * Everything commits in one system transaction, the one the deduplicator of the kit opened for the
 * delivery (the event belongs to no organization, the memberships to several): a bounded exception
 * of `MODULE.md`, whose queries name the account. The directory entry is locked first, so the
 * events of one account apply one after the other, and an entry already deleted ends the work:
 * applying the event twice changes nothing.
 *
 * An account that still owns an organization contradicts the contract (identity-service deletes no
 * owner): the whole event is refused with `DeletedOwnerRefusal` and nothing is written, so no
 * organization loses its owner; the delivery is retried, then becomes a dead letter.
 */
export class RemoveDeletedUser {
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
   * The time of the removals.
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
   * Takes the ports of the removal.
   *
   * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
   * @param {Clock} clock - The time of the removals.
   * @constructor
   */
  public constructor(unitOfWork: OrganizationsUnitOfWork, clock: Clock) {
    this.unitOfWork = unitOfWork;
    this.clock = clock;
  }
  // #endregion

  // #region Methods
  /**
   * Method execute
   *
   * @description
   * Applies the event.
   *
   * @param {RemoveDeletedUserInput} input - The event.
   * @returns {Promise<void>} Resolves once applied, or at once when it was applied already.
   * @throws {DeletedOwnerRefusal} When the account owns an organization; nothing is written.
   */
  public async execute(input: RemoveDeletedUserInput): Promise<void> {
    const now: Date = this.clock.now();
    try {
      await this.unitOfWork.runAcrossOrganizations(
        async (store: OrganizationsStore): Promise<void> => {
          const entry: DirectoryUser = await store.directory.lock(input.userId);
          if (entry.isDeleted) {
            return;
          }
          const memberships: readonly Member[] = await store.members.findActiveOfAccountForUpdate(
            input.userId,
          );
          assertOwnsNoOrganization(memberships);
          for (const membership of memberships) {
            const removed: Member = membership.remove(now);
            await store.members.update(removed);
            await store.events.memberRemovedBySystem(removed);
          }
          await store.directory.save(entry.applyDeletion(input.version));
        },
      );
    } catch (error) {
      if (error instanceof DeletedOwnerError) {
        throw new DeletedOwnerRefusal(error.organizationIds);
      }
      throw error;
    }
  }
  // #endregion
}
