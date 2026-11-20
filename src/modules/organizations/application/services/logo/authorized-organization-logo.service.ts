import type { OrganizationLogo } from '../../../domain/aggregates/logo/organization-logo.aggregate.js';
import { assertManagesOrganization } from '../../../domain/policies/members/member-permissions.policy.js';
import { OrganizationRefusal } from '../../models/refusals/organization-refusal.model.js';
import type { OrganizationLogoActor } from '../../models/logo/organization-logo-actor.model.js';
import type { OrganizationLogoStore } from '../../models/logo/organization-logo-store.model.js';

/** Locks current membership before locking the organization's logo state. */
export async function requireAuthorizedLogo(
  store: OrganizationLogoStore,
  actor: OrganizationLogoActor,
): Promise<OrganizationLogo> {
  const member = await store.lockMember(actor.organizationId, actor.actorUserId);
  if (
    member?.userId.toLowerCase() !== actor.actorUserId.toLowerCase() ||
    member.snapshot.organizationId.toLowerCase() !== actor.organizationId.toLowerCase()
  ) {
    throw new OrganizationRefusal({ reason: 'organization-not-found' });
  }
  assertManagesOrganization(member.role);
  const logo = await store.lockLogo(actor.organizationId);
  if (logo === null) throw new OrganizationRefusal({ reason: 'organization-not-found' });
  return logo;
}
