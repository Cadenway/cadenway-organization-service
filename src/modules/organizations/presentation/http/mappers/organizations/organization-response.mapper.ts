import type {
  MyOrganization,
  Organization,
} from '@cadenway/contracts/types/internal/organization-service';

import type { MyOrganizationView } from '../../../../application/projections/organizations/my-organization-view.projection.js';
import type { OrganizationView } from '../../../../application/projections/organizations/organization-view.projection.js';

/**
 * Function toOrganizationResponse
 *
 * @description
 * The `Organization` of the contract, dates in ISO 8601. Its `version` gives the `ETag` (the
 * `EtagInterceptor` of the kit).
 *
 * @param {OrganizationView} view - The organization.
 * @returns {Organization} The body.
 */
export function toOrganizationResponse(view: OrganizationView): Organization {
  return {
    id: view.id,
    name: view.name,
    slug: view.slug,
    description: view.description,
    website: view.website,
    logoId: view.logoId,
    defaultLanguage: view.defaultLanguage,
    plan: view.plan,
    memberCount: view.memberCount,
    role: view.role,
    createdAt: view.createdAt.toISOString(),
    version: view.version,
  };
}

/**
 * Function toMyOrganizationResponse
 *
 * @description
 * The `MyOrganization` of the contract, as the picker lists it.
 *
 * @param {MyOrganizationView} view - The organization of the actor.
 * @returns {MyOrganization} The item.
 */
export function toMyOrganizationResponse(view: MyOrganizationView): MyOrganization {
  return {
    id: view.id,
    name: view.name,
    slug: view.slug,
    role: view.role,
    memberCount: view.memberCount,
    plan: view.plan,
    joinedAt: view.joinedAt.toISOString(),
  };
}
