import { DomainError } from '../organizations/domain.error.js';

/**
 * Class MemberRemovedError
 *
 * @description
 * A change to a membership that was removed: a removed membership stays removed
 * (`asyncapi/organization-service.yaml`); a person who joins again gets a new membership.
 */
export class MemberRemovedError extends DomainError {
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
    super('The membership was removed and never changes again.');
  }
  // #endregion
}
