/**
 * Interface DirectoryRedelivery
 *
 * @description
 * How long the projection of the user directory keeps trying an event of identity-service whose
 * handling fails before it gives it up as a dead letter: the delay before each redelivery, the last
 * one repeating, and the deliveries, the first included, before the dead letter.
 */
export interface DirectoryRedelivery {
  // #region Properties
  /**
   * Property delaysMs
   *
   * @description
   * Delay before each redelivery, in milliseconds.
   *
   * @type {readonly number[]}
   * @readonly
   */
  readonly delaysMs: readonly number[];

  /**
   * Property maxDeliveries
   *
   * @description
   * Deliveries before the dead letter.
   *
   * @type {number}
   * @readonly
   */
  readonly maxDeliveries: number;
  // #endregion
}

/**
 * Constant DIRECTORY_REDELIVERY
 *
 * @description
 * The schedule of the three consumers of the directory (decision 3 of the P2b security
 * follow-ups): the directory decides which account accepts an invitation, so an event of
 * identity-service is not given up before 24 hours. 1 s, 5 s, 30 s, 2 min, 10 min, 30 min, then
 * every hour, 32 deliveries: the 31 redeliveries wait 92,556 s, about 25 h 43 min, before the dead
 * letter, the schedule the README of `@cadenway/nest-messaging` gives for security projections.
 *
 * @type {DirectoryRedelivery}
 */
export const DIRECTORY_REDELIVERY: DirectoryRedelivery = {
  delaysMs: [1_000, 5_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000],
  maxDeliveries: 32,
};
