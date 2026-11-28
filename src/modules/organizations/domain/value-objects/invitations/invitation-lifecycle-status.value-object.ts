/**
 * Type InvitationLifecycleStatus
 *
 * @description
 * What `getInvitation` answers of an invitation (`InvitationState.status` of
 * `openapi/internal/organization-service.yaml`): `pending` or `expired` while it waits for an
 * answer, before and from its expiry, then `accepted`, `refused` or `revoked` as stored.
 *
 * @type {'pending' | 'accepted' | 'refused' | 'revoked' | 'expired'}
 */
export type InvitationLifecycleStatus = 'pending' | 'accepted' | 'refused' | 'revoked' | 'expired';
