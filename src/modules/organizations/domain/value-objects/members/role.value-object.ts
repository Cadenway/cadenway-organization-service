/**
 * Type Role
 *
 * @description
 * Role of a member (decision 1 of P2b): `owner` ("Propriétaire", the creator, one per
 * organization), `admin` ("Administrateur"), `member` ("Membre") or `guest` ("Invité").
 *
 * @type {'owner' | 'admin' | 'member' | 'guest'}
 */
export type Role = 'owner' | 'admin' | 'member' | 'guest';

/**
 * Constant ROLES
 *
 * @description
 * Every role, in the order of the filter tabs of "Membres" (`Organisation.dc.html`).
 *
 * @type {readonly Role[]}
 */
export const ROLES: readonly Role[] = ['owner', 'admin', 'member', 'guest'];
