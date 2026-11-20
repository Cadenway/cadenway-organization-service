import { Organization } from '../../../../../domain/aggregates/organization/organization.aggregate.js';
import type { organizations } from '../../schemas/organizations/organization.schema.js';

/**
 * Type OrganizationRow
 *
 * @description
 * A row of `organizations`.
 *
 * @type {typeof organizations.$inferSelect}
 */
export type OrganizationRow = typeof organizations.$inferSelect;

/**
 * Function toOrganization
 *
 * @description
 * Maps a row to the organization it stores; the search key of the name stays in the row.
 *
 * @param {OrganizationRow} row - The row.
 * @returns {Organization} The organization.
 */
export function toOrganization(row: OrganizationRow): Organization {
  return Organization.restore({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    website: row.website,
    logoId: row.logoId,
    defaultLanguage: row.defaultLanguage,
    plan: row.plan,
    teamSize: row.teamSize,
    primaryUse: row.primaryUse,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt,
    version: row.version,
  });
}
