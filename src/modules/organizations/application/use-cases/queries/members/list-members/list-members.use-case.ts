import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import { assertReadsMembers } from '../../../../../domain/policies/members/member-permissions.policy.js';
import { searchKeyOf } from '../../../../../domain/value-objects/search/search-key.value-object.js';
import { toMemberViewFor } from '../../../../mappers/members/member-view.mapper.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import type { MemberFilters } from '../../../../models/members/member-filters.model.js';
import type { Page } from '../../../../models/pagination/page.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { MemberView } from '../../../../projections/members/member-view.projection.js';
import { requireActorMembership } from '../../../../services/members/actor-membership.service.js';
import type { ListMembersInput } from './list-members.input.js';
import type { ListMembersOutput } from './list-members.output.js';

/**
 * Class ListMembers
 *
 * @description
 * Lists the active members of the organization of the request (`GET /internal/v1/members`) in a
 * read-only tenant snapshot, so the page and its counts observe the same membership state.
 * The page is sorted by name without regard to case or accents, then by id. Search matches
 * the name and address the same way. Owner, admins and members read it; a guest is refused
 * (`role-forbidden`, decision 1 of P2b). The two-step verification flag is visible to the owner
 * and admins only (`toMemberViewFor`).
 */
export class ListMembers {
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
   * Takes the ports of the list.
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
   * Lists one page.
   *
   * @param {ListMembersInput} input - The actor, the organization, the filters and the page.
   * @returns {Promise<ListMembersOutput>} The page, its total and the counts by role.
   * @throws {OrganizationRefusal} `organization-not-found` or `role-forbidden`.
   */
  public async execute(input: ListMembersInput): Promise<ListMembersOutput> {
    const search: string | null =
      input.search === null || input.search.trim().length === 0
        ? null
        : searchKeyOf(input.search.trim());
    const filters: MemberFilters = { search, roles: input.roles };
    try {
      return await this.unitOfWork.runInRequestOrganization(
        async (store: OrganizationsStore): Promise<ListMembersOutput> => {
          const actor: Member = await requireActorMembership(
            store,
            input.organizationId,
            input.actorUserId,
          );
          assertReadsMembers(actor.role);
          const page: Page<MemberView> = await store.members.list(
            input.organizationId,
            filters,
            input.after,
            input.limit,
          );
          return {
            page: {
              items: page.items.map((member: MemberView): MemberView =>
                toMemberViewFor(member, actor.role),
              ),
              next: page.next,
            },
            total: await store.members.count(input.organizationId, filters),
            counts: await store.members.countByRole(input.organizationId),
          };
        },
        { readOnly: true, isolationLevel: 'repeatable read' },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }
  // #endregion
}
