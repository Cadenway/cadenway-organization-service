import { DomainError } from './domain.error.js';

/**
 * Class InvalidWebsiteError
 *
 * @description
 * A website ("Site web") that is not an absolute `https` or `http` URL of at most 2048 characters
 * (`OrganizationPatch.website` of `openapi/public/organizations.yaml`). Any other scheme, such as
 * `javascript:`, is refused: the web application shows the value as a link.
 */
export class InvalidWebsiteError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the website.
   *
   * @constructor
   */
  public constructor() {
    super('A website is an absolute https or http URL of at most 2048 characters.');
  }
  // #endregion
}
