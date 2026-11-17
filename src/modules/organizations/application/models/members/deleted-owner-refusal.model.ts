/**
 * Class DeletedOwnerRefusal
 *
 * @description
 * Thrown by `RemoveDeletedUser` when `user.deleted.v1` names an account that still owns an
 * organization here, which the contract excludes. Nothing is applied: the delivery fails, is
 * retried on the schedule of the directory consumers, then becomes a dead letter for an operator
 * to replay once ownership is settled. Its message names no value of the event; the handler logs
 * the ids it carries.
 */
export class DeletedOwnerRefusal extends Error {
  // #region Properties
  /**
   * Property organizationIds
   *
   * @description
   * The organizations the deleted account owns here.
   *
   * @type {readonly string[]}
   * @readonly
   */
  public readonly organizationIds: readonly string[];
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Builds the refusal.
   *
   * @param {readonly string[]} organizationIds - The organizations the deleted account owns.
   * @constructor
   */
  public constructor(organizationIds: readonly string[]) {
    super('The deletion of an account that owns an organization was refused.');
    this.name = 'DeletedOwnerRefusal';
    this.organizationIds = organizationIds;
  }
  // #endregion
}
