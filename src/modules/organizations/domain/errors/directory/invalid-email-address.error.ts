import { DomainError } from '../organizations/domain.error.js';

/**
 * Class InvalidEmailAddressError
 *
 * @description
 * A value that cannot be an email address: empty once trimmed, longer than 254 characters, or
 * without a single `@` between a local part and a domain.
 */
export class InvalidEmailAddressError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the value, without quoting it.
   *
   * @constructor
   */
  public constructor() {
    super('The value is not an email address.');
  }
  // #endregion
}
