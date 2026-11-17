import type { MemberState } from './member-state.value-object.js';

/**
 * Type MemberDraft
 *
 * @description
 * A membership not stored yet: PostgreSQL assigns its id on insert, and it is never removed yet.
 *
 * @type {Omit<MemberState, 'id' | 'removedAt'>}
 */
export type MemberDraft = Omit<MemberState, 'id' | 'removedAt'>;
