import { InvalidWebsiteError } from '../../errors/organizations/invalid-website.error.js';

/**
 * Constant UNSAFE_CHARACTERS
 *
 * @description
 * Characters a URL never carries unencoded (RFC 3986): spaces, controls, quotes, angle brackets
 * and the like. The value is kept as typed and shown as a link by every consumer, so one that
 * could break out of an HTML attribute is refused rather than stored.
 *
 * @type {RegExp}
 */
const UNSAFE_CHARACTERS: RegExp = /[\s\p{Cc}"'<>`\\^{|}]/u;

/**
 * Class Website
 *
 * @description
 * The website of an organization ("Site web"): an absolute `https` or `http` URL of at most 2048
 * characters (`OrganizationPatch.website` of `openapi/public/organizations.yaml`), without
 * credentials (`https://ateliernord.fr@other.example` would show one host and lead to another).
 * The value is kept as typed, trimmed, so the settings show it back unchanged.
 */
export class Website {
  // #region Properties
  /**
   * Property MAX_LENGTH
   *
   * @description
   * Longest website, in characters.
   *
   * @type {number}
   * @readonly
   */
  public static readonly MAX_LENGTH: number = 2048;

  /**
   * Property value
   *
   * @description
   * The URL.
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
   * Keeps a checked URL.
   *
   * @param {string} value - The URL.
   * @constructor
   */
  private constructor(value: string) {
    this.value = value;
  }
  // #endregion

  // #region Methods
  /**
   * Method parse
   *
   * @description
   * Checks a website.
   *
   * @param {string} raw - The URL as typed.
   * @returns {Website} The website.
   * @throws {InvalidWebsiteError} When it is not an absolute http or https URL of 2048 characters
   * at most, carries credentials, or holds a character a URL never carries unencoded.
   */
  public static parse(raw: string): Website {
    const value: string = raw.trim();
    if (
      value.length > Website.MAX_LENGTH ||
      UNSAFE_CHARACTERS.test(value) ||
      !URL.canParse(value)
    ) {
      throw new InvalidWebsiteError();
    }
    const { protocol, hostname, username, password } = new URL(value);
    if (
      (protocol !== 'https:' && protocol !== 'http:') ||
      hostname.length === 0 ||
      username.length > 0 ||
      password.length > 0
    ) {
      throw new InvalidWebsiteError();
    }
    return new Website(value);
  }
  // #endregion
}
