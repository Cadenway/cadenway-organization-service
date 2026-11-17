import type { Member } from '../../aggregates/member/member.aggregate.js';
import { DeletedOwnerError } from '../../errors/members/deleted-owner.error.js';

/**
 * Function assertOwnsNoOrganization
 *
 * @description
 * Checks that a deleted account owns none of the organizations it belongs to before its
 * memberships are removed (`user.deleted.v1` in `asyncapi/identity-service.yaml`: the account a
 * consumer receives owns none). Every organization keeps its one owner (decision 1 of P2b), so a
 * deletion that contradicts the contract is refused as a whole rather than applied in part.
 *
 * @param {readonly Member[]} memberships - The active memberships of the deleted account.
 * @throws {DeletedOwnerError} When one of them is the owner of its organization.
 */
export function assertOwnsNoOrganization(memberships: readonly Member[]): void {
  const owned: readonly string[] = memberships
    .filter((membership: Member): boolean => membership.role === 'owner')
    .map((membership: Member): string => membership.snapshot.organizationId);
  if (owned.length > 0) {
    throw new DeletedOwnerError(owned);
  }
}
