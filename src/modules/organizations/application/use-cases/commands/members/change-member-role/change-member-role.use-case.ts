import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import { assertManagesOrganization } from '../../../../../domain/policies/members/member-permissions.policy.js';
import { toMemberViewFor } from '../../../../mappers/members/member-view.mapper.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { MemberView } from '../../../../projections/members/member-view.projection.js';
import { requireActorMembership } from '../../../../services/members/actor-membership.service.js';
import { assertVersionMatches } from '../../../../services/versions/version-check.service.js';
import type { ChangeMemberRoleInput } from './change-member-role.input.js';

/**
 * Class ChangeMemberRole
 *
 * @description
 * Gives a member of the organization of the request another role
 * (`PATCH /internal/v1/members/{memberId}`), at once and without a seat check, in its tenant
 * transaction. Checks, in order: the actor belongs to it (`organization-not-found`), is its owner
 * or an admin (`role-forbidden`), the member exists in it (`member-not-found`), `If-Match` matches
 * (`version-mismatch`), and the member is not the owner (`owner-protected`). The same role answers
 * the member unchanged and appends nothing; another one writes the next version and appends
 * `member.role-changed.v1` in the same transaction.
 */
export class ChangeMemberRole {
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
   * Takes the ports of the change.
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
   * Changes the role.
   *
   * @param {ChangeMemberRoleInput} input - The actor, the organization, the member and its role.
   * @returns {Promise<MemberView>} The member after the change.
   * @throws {OrganizationRefusal} `organization-not-found`, `role-forbidden`, `member-not-found`,
   * `version-mismatch` or `owner-protected`.
   */
  public async execute(input: ChangeMemberRoleInput): Promise<MemberView> {
    try {
      return await this.unitOfWork.runInRequestOrganization(
        async (store: OrganizationsStore): Promise<MemberView> => {
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
          assertVersionMatches(input.expectedVersion, member.snapshot.version);
          const changed: Member = member.changeRole(input.role);
          if (changed !== member) {
            await store.members.update(changed);
            await store.events.memberRoleChanged(changed, member.role, input.actorUserId);
          }
          const view: MemberView | null = await store.members.view(
            input.organizationId,
            input.memberId,
          );
          if (view === null) {
            throw new OrganizationRefusal({ reason: 'member-not-found' });
          }
          return toMemberViewFor(view, actor.role);
        },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }
  // #endregion
}
