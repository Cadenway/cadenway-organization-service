/**
 * Interface KeyedInvitationBatchUsage
 *
 * @description
 * What an organization holds of its replay record budget at one instant, read up to the budget
 * only: the keyed batches still running under a live lease, and the expiries of its newest stored
 * outcomes still inside their 24 hours, as many as the places the running batches leave
 * (`openapi/internal/organization-service.yaml`, `inviteMembersKeyedInternal`, "Replay record
 * budget").
 */
export interface KeyedInvitationBatchUsage {
  // #region Properties
  /**
   * Property running
   *
   * @description
   * The reservations whose lease is still live, counted up to the budget: `0` or more, never more
   * than the budget it was read for.
   *
   * @type {number}
   * @readonly
   */
  readonly running: number;

  /**
   * Property newestStoredExpiries
   *
   * @description
   * The expiries of the newest stored outcomes still inside their 24 hours, at most as many as
   * the budget minus `running`, in any order. Fewer than that means the organization holds fewer
   * stored outcomes.
   *
   * @type {readonly Date[]}
   * @readonly
   */
  readonly newestStoredExpiries: readonly Date[];

  /**
   * Property readAt
   *
   * @description
   * The instant of the read, on the clock the expiries are written on.
   *
   * @type {Date}
   * @readonly
   */
  readonly readAt: Date;
  // #endregion
}
