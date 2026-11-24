import { DomainError } from './domain.error.js';

/**
 * Class SlugReservedError
 *
 * @description
 * An address ("Adresse") that the web application keeps as the first path segment of its own
 * pages, given or derived from the name (`organization.slug-reserved`, `Slug` of
 * `openapi/public/organizations.yaml`).
 */
export class SlugReservedError extends DomainError {
  // #region Properties
  /**
   * Property slug
   *
   * @description
   * The reserved address, as derived or given; returned to the caller in `details.slug`.
   *
   * @type {string}
   * @readonly
   */
  public readonly slug: string;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the address.
   *
   * @param {string} slug - The reserved address.
   * @constructor
   */
  public constructor(slug: string) {
    super('This organization address is reserved by the web application.');
    this.slug = slug;
  }
  // #endregion
}
