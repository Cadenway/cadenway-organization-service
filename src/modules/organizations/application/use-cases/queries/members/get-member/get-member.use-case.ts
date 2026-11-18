import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import { assertReadsMembers } from '../../../../../domain/policies/members/member-permissions.policy.js';
import { toMemberViewFor } from '../../../../mappers/members/member-view.mapper.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { MemberView } from '../../../../projections/members/member-view.projection.js';
import { requireActorMembership } from '../../../../services/members/actor-membership.service.js';
import type { GetMemberInput } from './get-member.input.js';

/**
 * Class GetMember
 *
 * @description
 * Reads one active member of the organization of the request (`GET /internal/v1/members/{memberId}`)
 * in a read-only tenant transaction. A member of another organization is invisible to it and
 * answers like an unknown id (`member-not-found`, decision 9 of P2b); a guest is refused
 * (`role-forbidden`). Whether the member has two-step verification is answered to the owner and
 * the admins only (`toMemberViewFor`).
 */
export class GetMember {
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
   * Takes the ports of the reading.
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
   * Reads the member.
   *
   * @param {GetMemberInput} input - The actor, the organization and the member.
   * @returns {Promise<MemberView>} The member.
   * @throws {OrganizationRefusal} `organization-not-found`, `role-forbidden` or `member-not-found`.
   */
  public async execute(input: GetMemberInput): Promise<MemberView> {
    try {
      return await this.unitOfWork.runInRequestOrganization(
        async (store: OrganizationsStore): Promise<MemberView> => {
          const actor: Member = await requireActorMembership(
            store,
            input.organizationId,
            input.actorUserId,
          );
          assertReadsMembers(actor.role);
          const member: MemberView | null = await store.members.view(
            input.organizationId,
            input.memberId,
          );
          if (member === null) {
            throw new OrganizationRefusal({ reason: 'member-not-found' });
          }
          return toMemberViewFor(member, actor.role);
        },
        { readOnly: true },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }
  // #endregion
}
