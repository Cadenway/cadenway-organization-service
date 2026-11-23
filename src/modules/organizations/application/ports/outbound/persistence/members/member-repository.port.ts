import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import type { EmailAddress } from '../../../../../domain/value-objects/email/email-address.value-object.js';
import type { MemberDraft } from '../../../../../domain/value-objects/members/member-draft.value-object.js';
import type { MemberFilters } from '../../../../models/members/member-filters.model.js';
import type { Page } from '../../../../models/pagination/page.model.js';
import type { PagePosition } from '../../../../models/pagination/page-position.model.js';
import type { MemberView } from '../../../../projections/members/member-view.projection.js';
import type { RoleCounts } from '../../../../projections/members/role-counts.projection.js';

/**
 * Interface MemberRepository
 *
 * @description
 * The memberships, bound to the transaction of a unit of work. Cross-organization account lookups
 * name the account in a system transaction. Only active memberships are read, a removed one is
 * kept for its version only.
 */
export interface MemberRepository {
  // #region Methods
  /**
   * Method insert
   *
   * @description
   * Stores a new membership; PostgreSQL assigns its id.
   *
   * @param {MemberDraft} draft - The membership to store.
   * @returns {Promise<Member>} The stored membership, with its id.
   */
  insert(draft: MemberDraft): Promise<Member>;

  /**
   * Method findActiveOfUser
   *
   * @description
   * Loads the active membership of an account in an organization.
   *
   * @param {string} organizationId - The organization.
   * @param {string} userId - The account.
   * @param {'share'} lock - Optionally blocks role changes and removals until commit.
   * @returns {Promise<Member | null>} The membership, or `null` when the account is not a member.
   */
  findActiveOfUser(organizationId: string, userId: string, lock?: 'share'): Promise<Member | null>;

  /** Locks the actor and target memberships in ID order and returns their current states. */
  lockActorAndTarget(
    organizationId: string,
    actorUserId: string,
    memberId: string,
  ): Promise<readonly Member[]>;

  /**
   * Method findActiveOfAccountForUpdate
   *
   * @description
   * Loads the active memberships of an account in every organization and locks them until the end
   * of the transaction, by organization then id. A read across organizations, for the removal of a
   * deleted account in a system transaction: a bounded exception of `MODULE.md`, filtered on the
   * account.
   *
   * @param {string} userId - The account.
   * @returns {Promise<readonly Member[]>} The memberships, none when the account belongs nowhere.
   */
  findActiveOfAccountForUpdate(userId: string): Promise<readonly Member[]>;

  /** A bounded list of current owned organizations under the account directory lock. */
  listOwnedOrganizationIds(userId: string, limit: number): Promise<readonly string[]>;

  /**
   * Method update
   *
   * @description
   * Writes the role, the removal and the version of a membership locked by `lockActorAndTarget` or
   * `findActiveOfAccountForUpdate`.
   *
   * @param {Member} member - The membership after the change.
   * @returns {Promise<void>} Resolves once written.
   */
  update(member: Member): Promise<void>;

  /**
   * Method hasActiveMemberWithEmail
   *
   * @description
   * Whether an active member of an organization has this address, verified, in the user
   * directory: an address an account only signed up with proves nothing.
   *
   * @param {string} organizationId - The organization.
   * @param {EmailAddress} email - The address.
   * @returns {Promise<boolean>} Whether the address is that of a member.
   */
  hasActiveMemberWithEmail(organizationId: string, email: EmailAddress): Promise<boolean>;

  /**
   * Method countSeats
   *
   * @description
   * Counts the active members that take a seat: owner, admins and members.
   *
   * @param {string} organizationId - The organization.
   * @returns {Promise<number>} The count.
   */
  countSeats(organizationId: string): Promise<number>;

  /**
   * Serializes seat increases for this organization until the transaction ends.
   *
   * @param organizationId - The tenant whose seat capacity is being checked.
   * @returns Resolves after acquiring the transaction-scoped lock.
   */
  lockSeatAdmission(organizationId: string): Promise<void>;

  /**
   * Method countByRole
   *
   * @description
   * Counts the active members by role.
   *
   * @param {string} organizationId - The organization.
   * @returns {Promise<RoleCounts>} The counts.
   */
  countByRole(organizationId: string): Promise<RoleCounts>;

  /**
   * Method view
   *
   * @description
   * Reads an active member with the name, address and two-step verification of its account. The
   * two-step verification is always read; the use case decides whether the actor sees it.
   *
   * @param {string} organizationId - The organization.
   * @param {string} memberId - Id of the membership.
   * @returns {Promise<MemberView | null>} The member, or `null`.
   */
  view(organizationId: string, memberId: string): Promise<MemberView | null>;

  /**
   * Method list
   *
   * @description
   * One page of the active members that match the filters, sorted by the search key of their name,
   * then by id, each with the two-step verification of its account, as `view` reads it.
   *
   * @param {string} organizationId - The organization.
   * @param {MemberFilters} filters - The search and the roles.
   * @param {PagePosition | null} after - Where the previous page ended, or `null`.
   * @param {number} limit - Page size.
   * @returns {Promise<Page<MemberView>>} The page.
   */
  list(
    organizationId: string,
    filters: MemberFilters,
    after: PagePosition | null,
    limit: number,
  ): Promise<Page<MemberView>>;

  /**
   * Method count
   *
   * @description
   * Counts the active members that match the filters, on every page.
   *
   * @param {string} organizationId - The organization.
   * @param {MemberFilters} filters - The search and the roles.
   * @returns {Promise<number>} The count.
   */
  count(organizationId: string, filters: MemberFilters): Promise<number>;
  // #endregion
}
