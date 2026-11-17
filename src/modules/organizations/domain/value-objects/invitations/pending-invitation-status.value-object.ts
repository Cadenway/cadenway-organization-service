/**
 * Type PendingInvitationStatus
 *
 * @description
 * What the pending list shows of a pending invitation: `pending` ("Expire dans {n} jours") before
 * its expiry, `expired` ("Expirée le {date}") from then on (`Invitation.status` of
 * `openapi/public/members.yaml`).
 *
 * @type {'pending' | 'expired'}
 */
export type PendingInvitationStatus = 'pending' | 'expired';
