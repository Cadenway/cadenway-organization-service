import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import { assertManagesOrganization } from '../../../../../domain/policies/members/member-permissions.policy.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { requireActorMembership } from '../../../../services/members/actor-membership.service.js';
import type { ListInvitationsInput } from './list-invitations.input.js';
import type { ListInvitationsOutput } from './list-invitations.output.js';

/**
 * Class ListInvitations
 *
 * @description
 * Lists the pending invitations of the organization of the request
 * (`GET /internal/v1/invitations`), the expired ones included ("Expirée le {date}"), the most
 * recently sent first, in a read-only tenant transaction. Pending invitations are visible to the
 * owner and the admins only (`role-forbidden`, decision 1 of P2b).
 */
export class ListInvitations {
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
   * The instant that tells `pending` from `expired`.
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
   * Lists one page.
   *
   * @param {ListInvitationsInput} input - The actor, the organization and the page.
   * @returns {Promise<ListInvitationsOutput>} The page and the count.
   * @throws {OrganizationRefusal} `organization-not-found` or `role-forbidden`.
   */
  public async execute(input: ListInvitationsInput): Promise<ListInvitationsOutput> {
    const now: Date = this.clock.now();
    try {
      return await this.unitOfWork.runInRequestOrganization(
        async (store: OrganizationsStore): Promise<ListInvitationsOutput> => {
          const actor: Member = await requireActorMembership(
            store,
            input.organizationId,
            input.actorUserId,
          );
          assertManagesOrganization(actor.role);
          return {
            page: await store.invitations.listPending(
              input.organizationId,
              now,
              input.after,
              input.limit,
            ),
            total: await store.invitations.countPending(input.organizationId),
          };
        },
        { readOnly: true },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }
  // #endregion
}
