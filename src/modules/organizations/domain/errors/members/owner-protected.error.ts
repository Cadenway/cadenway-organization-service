import { DomainError } from '../organizations/domain.error.js';

/**
 * Class OwnerProtectedError
 *
 * @description
 * A change of role or a removal of the owner: nobody changes the role of the owner or removes them
 * (decision 1 of P2b, `member.owner-protected`).
 */
export class OwnerProtectedError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the change.
   *
   * @constructor
   */
  public constructor() {
    super('The owner is neither removed nor given another role.');
  }
  // #endregion
}
