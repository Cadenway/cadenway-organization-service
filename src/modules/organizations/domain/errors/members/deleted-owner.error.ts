import { DomainError } from '../organizations/domain.error.js';

/**
 * Class DeletedOwnerError
 *
 * @description
 * The deletion of an account that still owns an organization here. identity-service refuses to
 * delete the owner of an organization (`409 account.organization-owner`) and `user.deleted.v1`
 * promises that the account owns none, so this one contradicts the contract: removing the
 * memberships would leave an organization without its owner (decision 1 of P2b: one owner, never
 * removed). The deletion is refused as a whole.
 */
export class DeletedOwnerError extends DomainError {
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
   * Refuses the deletion.
   *
   * @param {readonly string[]} organizationIds - The organizations the account owns.
   * @constructor
   */
  public constructor(organizationIds: readonly string[]) {
    super('A deleted account still owns an organization.');
    this.organizationIds = organizationIds;
  }
  // #endregion
}
