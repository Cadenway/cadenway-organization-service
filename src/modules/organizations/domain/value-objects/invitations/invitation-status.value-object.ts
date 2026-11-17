/**
 * Type InvitationStatus
 *
 * @description
 * Stored state of an invitation: `pending` until the invitee accepts or refuses it, or an owner or
 * an admin revokes it. An expired invitation stays `pending` ("Expirée le {date}" in the pending
 * list) until it is resent or revoked (`openapi/public/members.yaml`).
 *
 * @type {'pending' | 'accepted' | 'refused' | 'revoked'}
 */
export type InvitationStatus = 'pending' | 'accepted' | 'refused' | 'revoked';
