import { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import type { members } from '../../schemas/members/member.schema.js';

/**
 * Type MemberRow
 *
 * @description
 * A row of `members`.
 *
 * @type {typeof members.$inferSelect}
 */
export type MemberRow = typeof members.$inferSelect;

/**
 * Function toMember
 *
 * @description
 * Maps a row to the membership it stores.
 *
 * @param {MemberRow} row - The row.
 * @returns {Member} The membership.
 */
export function toMember(row: MemberRow): Member {
  return Member.restore({
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    role: row.role,
    invitationId: row.invitationId,
    joinedAt: row.joinedAt,
    removedAt: row.removedAt,
    version: row.version,
  });
}
