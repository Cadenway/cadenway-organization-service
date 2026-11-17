import { InvalidEmailAddressError } from '../../errors/directory/invalid-email-address.error.js';

/**
 * Constant EMAIL_FORMAT
 *
 * @description
 * One `@` between a local part and a domain, neither empty nor holding a space. The contract
 * validates the full format at the edge (`format: email`); this keeps the domain from storing a
 * value that cannot be one.
 *
 * @type {RegExp}
 */
const EMAIL_FORMAT: RegExp = /^[^\s@]+@[^\s@]+$/u;

/**
 * Class EmailAddress
 *
 * @description
 * An email address in the one form every comparison of this service uses: trimmed and lowercased,
 * since the contracts compare addresses "without regard to case" and identity-service stores them
 * that way. At most 254 characters (`Email` of `openapi/internal/organization-service.yaml`).
 */
export class EmailAddress {
  // #region Properties
  /**
   * Property MAX_LENGTH
   *
   * @description
   * Longest address, in characters.
   *
   * @type {number}
   * @readonly
   */
  public static readonly MAX_LENGTH: number = 254;

  /**
   * Property value
   *
   * @description
   * The trimmed, lowercased address.
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
   * Keeps a value checked by `parse`.
   *
   * @param {string} value - The normalized address.
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
   * Normalizes and checks an address.
   *
   * @param {string} raw - The address as received.
   * @returns {EmailAddress} The address.
   * @throws {InvalidEmailAddressError} When the value cannot be an address.
   */
  public static parse(raw: string): EmailAddress {
    const value: string = raw.trim().toLowerCase();
    if (value.length > EmailAddress.MAX_LENGTH || !EMAIL_FORMAT.test(value)) {
      throw new InvalidEmailAddressError();
    }
    return new EmailAddress(value);
  }

  /**
   * Method equals
   *
   * @description
   * Whether two addresses are the same, without regard to case.
   *
   * @param {EmailAddress} other - The other address.
   * @returns {boolean} Whether they are equal.
   */
  public equals(other: EmailAddress): boolean {
    return this.value === other.value;
  }
  // #endregion
}
