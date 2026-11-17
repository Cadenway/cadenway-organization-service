import type { InvitationState } from './invitation-state.value-object.js';

/**
 * Type InvitationDraft
 *
 * @description
 * An invitation not stored yet: PostgreSQL assigns its id on insert.
 *
 * @type {Omit<InvitationState, 'id'>}
 */
export type InvitationDraft = Omit<InvitationState, 'id'>;
