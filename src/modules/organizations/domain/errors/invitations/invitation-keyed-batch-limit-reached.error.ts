import { DomainError } from '../organizations/domain.error.js';

/**
 * Class InvitationKeyedBatchLimitReachedError
 *
 * @description
 * A keyed invitation batch with a new key while its organization already holds as many keyed
 * batches as its replay record budget allows (`invitation.keyed-batch-limit-reached`, with
 * `details.nextAvailableAt`). Nothing is created, sent, emitted or stored, and the key is not
 * reserved.
 */
export class InvitationKeyedBatchLimitReachedError extends DomainError {
  // #region Properties
  /**
   * Property nextAvailableAt
   *
   * @description
   * When a place in the budget frees up at the latest: the expiry of the stored outcome whose end
   * brings the count below the budget, or a short delay away when running batches alone fill it.
   *
   * @type {Date}
   * @readonly
   */
  public readonly nextAvailableAt: Date;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the batch.
   *
   * @param {Date} nextAvailableAt - When a place frees up.
   * @constructor
   */
  public constructor(nextAvailableAt: Date) {
    super('The replay record budget of keyed invitation batches has been reached.');
    this.nextAvailableAt = nextAvailableAt;
  }
  // #endregion
}
