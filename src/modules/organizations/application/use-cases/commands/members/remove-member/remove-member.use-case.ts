import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import { assertManagesOrganization } from '../../../../../domain/policies/members/member-permissions.policy.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { requireActorMembership } from '../../../../services/members/actor-membership.service.js';
import type { RemoveMemberInput } from './remove-member.input.js';

/**
 * Class RemoveMember
 *
 * @description
 * Removes a member from the organization of the request (`DELETE /internal/v1/members/{memberId}`)
 * in its tenant transaction. Checks, in order: the actor belongs to it (`organization-not-found`),
 * is its owner or an admin (`role-forbidden`), the member exists in it (`member-not-found`) and is
 * not the owner (`owner-protected`). The removal and `member.removed.v1`, with which
 * identity-service stops the sessions and tokens of the member on the organization, commit
 * together. The membership row is kept, removed, with its last version.
 */
export class RemoveMember {
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
   * The time of the removal.
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
   * @param {Clock} clock - The time of the removal.
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
   * Removes the member.
   *
   * @param {RemoveMemberInput} input - The actor, the organization and the member.
   * @returns {Promise<void>} Resolves once removed.
   * @throws {OrganizationRefusal} `organization-not-found`, `role-forbidden`, `member-not-found` or
   * `owner-protected`.
   */
  public async execute(input: RemoveMemberInput): Promise<void> {
    const now: Date = this.clock.now();
    try {
      await this.unitOfWork.runInRequestOrganization(
        async (store: OrganizationsStore): Promise<void> => {
          const actor: Member = await requireActorMembership(
            store,
            input.organizationId,
            input.actorUserId,
          );
          assertManagesOrganization(actor.role);
          const member: Member | null = await store.members.findActiveForUpdate(
            input.organizationId,
            input.memberId,
          );
          if (member === null) {
            throw new OrganizationRefusal({ reason: 'member-not-found' });
          }
          const removed: Member = member.remove(now);
          await store.members.update(removed);
          await store.events.memberRemoved(removed, input.actorUserId);
        },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }
  // #endregion
}
