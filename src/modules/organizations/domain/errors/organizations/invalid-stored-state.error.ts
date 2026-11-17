import { DomainError } from './domain.error.js';

/**
 * Class InvalidStoredStateError
 *
 * @description
 * A stored organization, member, invitation or directory entry whose state breaks an invariant: a
 * defect of the data, never an answer to a caller.
 */
export class InvalidStoredStateError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Names the aggregate and the broken invariant.
   *
   * @param {string} aggregate - Kind of the stored aggregate.
   * @param {string} invariant - Which invariant the stored state breaks.
   * @constructor
   */
  public constructor(aggregate: string, invariant: string) {
    super(`The stored ${aggregate} breaks an invariant: ${invariant}.`);
  }
  // #endregion
}
