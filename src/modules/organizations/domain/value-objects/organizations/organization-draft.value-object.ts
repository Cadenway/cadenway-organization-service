import type { OrganizationState } from './organization-state.value-object.js';

/**
 * Type OrganizationDraft
 *
 * @description
 * An organization not stored yet: PostgreSQL assigns its id on insert.
 *
 * @type {Omit<OrganizationState, 'id'>}
 */
export type OrganizationDraft = Omit<OrganizationState, 'id'>;
