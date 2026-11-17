import type { Member } from '../../../domain/aggregates/member/member.aggregate.js';
import { OrganizationRefusal } from '../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../models/transactions/organizations-store.model.js';

/**
 * Function requireActorMembership
 *
 * @description
 * Loads the active membership of the actor in the organization of the request. An actor that does
 * not belong to it, for example a member removed since the token was signed, is answered like an
 * unknown organization (`organization.not-found`): isolation answers 404, never 403
 * (decision 9 of P2b).
 *
 * @param {OrganizationsStore} store - The store of the transaction.
 * @param {string} organizationId - The organization of the request.
 * @param {string} actorUserId - The actor of the request.
 * @returns {Promise<Member>} The membership of the actor.
 * @throws {OrganizationRefusal} `organization-not-found`.
 */
export async function requireActorMembership(
  store: OrganizationsStore,
  organizationId: string,
  actorUserId: string,
): Promise<Member> {
  const membership: Member | null = await store.members.findActiveOfUser(
    organizationId,
    actorUserId,
  );
  if (membership === null) {
    throw new OrganizationRefusal({ reason: 'organization-not-found' });
  }
  return membership;
}
