import { DomainError } from './domain.error.js';

/**
 * Class InvalidOrganizationNameError
 *
 * @description
 * A name ("Nom") that is empty once its surrounding spaces are removed, or longer than 120
 * characters (`OrganizationName` of `openapi/public/organizations.yaml`).
 */
export class InvalidOrganizationNameError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the name.
   *
   * @constructor
   */
  public constructor() {
    super('An organization name has 1 to 120 characters besides its surrounding spaces.');
  }
  // #endregion
}
