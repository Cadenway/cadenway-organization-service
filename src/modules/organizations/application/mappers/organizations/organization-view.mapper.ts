import type { Organization } from '../../../domain/aggregates/organization/organization.aggregate.js';
import type { Role } from '../../../domain/value-objects/members/role.value-object.js';
import type { OrganizationState } from '../../../domain/value-objects/organizations/organization-state.value-object.js';
import type { OrganizationView } from '../../projections/organizations/organization-view.projection.js';

/**
 * Function toOrganizationView
 *
 * @description
 * The organization as a member reads it: its profile, without the answers of the creation form,
 * which no route returns in this version.
 *
 * @param {Organization} organization - The organization.
 * @param {Role} role - Role of the reader in it.
 * @param {number} memberCount - Members that take a seat.
 * @returns {OrganizationView} The view.
 */
export function toOrganizationView(
  organization: Organization,
  role: Role,
  memberCount: number,
): OrganizationView {
  const state: OrganizationState = organization.snapshot;
  return {
    id: state.id,
    name: state.name,
    slug: state.slug,
    description: state.description,
    website: state.website,
    defaultLanguage: state.defaultLanguage,
    plan: state.plan,
    memberCount,
    role,
    createdAt: state.createdAt,
    version: state.version,
  };
}
