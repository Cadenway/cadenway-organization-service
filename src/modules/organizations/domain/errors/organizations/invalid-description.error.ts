import { DomainError } from './domain.error.js';

/**
 * Class InvalidDescriptionError
 *
 * @description
 * A description ("Description (facultatif)") longer than 280 characters (`Organisation.dc.html`,
 * `OrganizationPatch.description` of `openapi/public/organizations.yaml`).
 */
export class InvalidDescriptionError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the description.
   *
   * @constructor
   */
  public constructor() {
    super('An organization description has at most 280 characters.');
  }
  // #endregion
}
