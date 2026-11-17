import { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { invitations } from '../../schemas/invitations/invitation.schema.js';

/**
 * Type InvitationRow
 *
 * @description
 * A row of `invitations`.
 *
 * @type {typeof invitations.$inferSelect}
 */
export type InvitationRow = typeof invitations.$inferSelect;

/**
 * Function toInvitation
 *
 * @description
 * Maps a row to the invitation it stores.
 *
 * @param {InvitationRow} row - The row.
 * @returns {Invitation} The invitation.
 */
export function toInvitation(row: InvitationRow): Invitation {
  return Invitation.restore({
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role,
    invitedByUserId: row.invitedByUserId,
    status: row.status,
    sentAt: row.sentAt,
    expiresAt: row.expiresAt,
    answeredAt: row.answeredAt,
    version: row.version,
  });
}
