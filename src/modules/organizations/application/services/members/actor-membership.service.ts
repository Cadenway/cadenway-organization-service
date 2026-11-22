import type { Member } from '../../../domain/aggregates/member/member.aggregate.js';
import { assertManagesOrganization } from '../../../domain/policies/members/member-permissions.policy.js';
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

/** Authorizes a membership mutation from the current actor and target locked by its transaction. */
export async function requireManagingMembership(
  store: OrganizationsStore,
  input: {
    readonly organizationId: string;
    readonly actorUserId: string;
    readonly memberId: string;
  },
): Promise<{ readonly actor: Member; readonly member: Member }> {
  const candidate = await requireActorMembership(store, input.organizationId, input.actorUserId);
  assertManagesOrganization(candidate.role);
  const rows = await store.members.lockActorAndTarget(
    input.organizationId,
    input.actorUserId,
    input.memberId,
  );
  const actor = rows.find((row) => row.userId === input.actorUserId.toLowerCase());
  if (actor === undefined) {
    throw new OrganizationRefusal({ reason: 'organization-not-found' });
  }
  assertManagesOrganization(actor.role);
  const member = rows.find((row) => row.id === input.memberId.toLowerCase());
  if (member === undefined) {
    throw new OrganizationRefusal({ reason: 'member-not-found' });
  }
  return { actor, member };
}
