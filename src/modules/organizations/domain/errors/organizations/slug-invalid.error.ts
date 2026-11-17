import { DomainError } from './domain.error.js';

/**
 * Class SlugInvalidError
 *
 * @description
 * An address ("Adresse") that is not 2 to 63 lowercase letters, digits and single dashes, such as
 * the one derived from a name made of punctuation (`organization.slug-invalid`).
 */
export class SlugInvalidError extends DomainError {
  // #region Properties
  /**
   * Property slug
   *
   * @description
   * The refused address, as derived or given; returned to the caller in `details.slug`.
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
   * @param {string} slug - The refused address.
   * @constructor
   */
  public constructor(slug: string) {
    super('An organization address has 2 to 63 lowercase letters, digits and single dashes.');
    this.slug = slug;
  }
  // #endregion
}
