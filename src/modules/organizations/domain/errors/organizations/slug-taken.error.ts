import { DomainError } from './domain.error.js';

/**
 * Class SlugTakenError
 *
 * @description
 * An address already used by another organization: addresses are unique across organizations
 * (decision 10 of P2b, `organization.slug-taken`). The unique index of `organizations` decides it,
 * so a concurrent creation loses cleanly.
 */
export class SlugTakenError extends DomainError {
  // #region Properties
  /**
   * Property slug
   *
   * @description
   * The address already in use; returned to the caller in `details.slug`.
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
   * @param {string} slug - The address already in use.
   * @constructor
   */
  public constructor(slug: string) {
    super('Another organization already uses this address.');
    this.slug = slug;
  }
  // #endregion
}
