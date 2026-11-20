import type { OrganizationLogoBinding } from './organization-logo-binding.value-object.js';
import type { OrganizationLogoDeclaration } from './organization-logo-declaration.value-object.js';

/** Reservation state stored by Organization while Storage owns transfers and verified assets. */
export interface OrganizationLogoReservationState extends OrganizationLogoBinding {
  // #region Properties
  /** Image generation under which the owner allocated the reservation. */
  readonly generation: number;

  /** Declaration pinned before Storage issues the signed transfer. */
  readonly declaration: OrganizationLogoDeclaration;

  /** Exclusive owner deadline, independent of the earlier signed transfer expiry. */
  readonly expiresAt: Date;

  /** Only a pending reservation can commit or be terminally abandoned. */
  readonly state: 'pending' | 'committed' | 'expired' | 'superseded';
  // #endregion
}
