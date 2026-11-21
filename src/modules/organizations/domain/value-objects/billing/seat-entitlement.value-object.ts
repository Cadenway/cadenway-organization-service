/** The versioned part of a Billing entitlement that Organization needs for seat admission. */
export interface SeatEntitlement {
  // #region Properties
  /** Billing's plan identifier, including identifiers introduced after this deployment. */
  readonly plan: string;

  /** Maximum number of active memberships that take a seat. */
  readonly seatLimit: number;

  /** Monotone version assigned by Billing. Version zero is the legacy Free baseline. */
  readonly version: number;
  // #endregion
}

/** Effective entitlement before Billing has committed a version for an organization. */
export const FREE_SEAT_ENTITLEMENT: SeatEntitlement = {
  plan: 'free',
  seatLimit: 5,
  version: 0,
};
