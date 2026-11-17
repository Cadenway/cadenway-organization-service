import { SlugInvalidError } from '../../errors/organizations/slug-invalid.error.js';
import { searchKeyOf } from '../search/search-key.value-object.js';

/**
 * Constant SLUG_FORMAT
 *
 * @description
 * Lowercase letters and digits in runs joined by single dashes (`Slug` of
 * `openapi/public/organizations.yaml`).
 *
 * @type {RegExp}
 */
const SLUG_FORMAT: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Class Slug
 *
 * @description
 * The address of an organization ("Adresse", `app.cadenway.example/<slug>`), unique across
 * organizations (decision 10 of P2b). Derived from the name at creation as the creation form of
 * the mockup does (`Organisations.dc.html`), then editable in the settings.
 */
export class Slug {
  // #region Properties
  /**
   * Property MIN_LENGTH
   *
   * @description
   * Shortest address: the creation form disables its button below it.
   *
   * @type {number}
   * @readonly
   */
  public static readonly MIN_LENGTH: number = 2;

  /**
   * Property MAX_LENGTH
   *
   * @description
   * Longest address, the length of a DNS label.
   *
   * @type {number}
   * @readonly
   */
  public static readonly MAX_LENGTH: number = 63;

  /**
   * Property value
   *
   * @description
   * The address.
   *
   * @type {string}
   * @readonly
   */
  public readonly value: string;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps a checked address.
   *
   * @param {string} value - The address.
   * @constructor
   */
  private constructor(value: string) {
    this.value = value;
  }
  // #endregion

  // #region Methods
  /**
   * Method derive
   *
   * @description
   * Derives the address of a name as `POST /v1/organizations` describes it: accents removed,
   * lowercase, every run of other characters turned into `-`, dashes trimmed at both ends, cut to
   * 63 characters. A cut that ends on a dash drops it, so the result keeps the format.
   *
   * @param {string} name - The name of the organization.
   * @returns {Slug} The derived address.
   * @throws {SlugInvalidError} When the derived address has fewer than 2 characters.
   */
  public static derive(name: string): Slug {
    const derived: string = searchKeyOf(name)
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, Slug.MAX_LENGTH)
      .replace(/-+$/u, '');
    return Slug.parse(derived);
  }

  /**
   * Method parse
   *
   * @description
   * Checks an address given as is.
   *
   * @param {string} value - The address.
   * @returns {Slug} The address.
   * @throws {SlugInvalidError} When it is not 2 to 63 letters, digits and single dashes.
   */
  public static parse(value: string): Slug {
    if (
      value.length < Slug.MIN_LENGTH ||
      value.length > Slug.MAX_LENGTH ||
      !SLUG_FORMAT.test(value)
    ) {
      throw new SlugInvalidError(value);
    }
    return new Slug(value);
  }
  // #endregion
}
