import { InvalidStoredStateError } from '../../errors/organizations/invalid-stored-state.error.js';
import { EmailAddress } from '../../value-objects/email/email-address.value-object.js';
import type { DirectoryUserState } from '../../value-objects/directory/directory-user-state.value-object.js';

/**
 * Class DirectoryUser
 *
 * @description
 * An account of identity-service as this service knows it from its events (decision 4 of P2b,
 * `asyncapi/identity-service.yaml`). Rules:
 *
 * - each event applies by the `version` of the account: a part (the name, the address and its
 *   verification) changes only for a version above the one that last set it, so a late
 *   `user.signed-up.v1` never overwrites a newer profile, and a redelivered event changes nothing;
 * - `user.signed-up.v1` sets the name and the unverified address; `user.email-verified.v1` sets
 *   the verified address; `user.profile-updated.v1` sets the name;
 * - the account is known (`isSynchronized`) once its name and its address are; an invitation is
 *   matched with its verified address only (decision 5).
 */
export class DirectoryUser {
  // #region Properties
  /**
   * Property state
   *
   * @description
   * The state of the entry; an applied event returns a new `DirectoryUser`.
   *
   * @type {DirectoryUserState}
   * @readonly
   */
  private readonly state: DirectoryUserState;

  /**
   * Property userId
   *
   * @description
   * Id of the account.
   *
   * @type {string}
   * @readonly
   */
  public get userId(): string {
    return this.state.userId;
  }

  /**
   * Property name
   *
   * @description
   * Full name, or `null` before the sign-up is applied.
   *
   * @type {string | null}
   * @readonly
   */
  public get name(): string | null {
    return this.state.name;
  }

  /**
   * Property email
   *
   * @description
   * Address, verified or not, or `null` before the sign-up is applied.
   *
   * @type {EmailAddress | null}
   * @readonly
   */
  public get email(): EmailAddress | null {
    return this.state.email === null ? null : EmailAddress.parse(this.state.email);
  }

  /**
   * Property verifiedEmail
   *
   * @description
   * The address once a code proved it, else `null`.
   *
   * @type {EmailAddress | null}
   * @readonly
   */
  public get verifiedEmail(): EmailAddress | null {
    return this.state.emailVerified ? this.email : null;
  }

  /**
   * Property isSynchronized
   *
   * @description
   * Whether the sign-up of the account is applied: its name and its address are known.
   *
   * @type {boolean}
   * @readonly
   */
  public get isSynchronized(): boolean {
    return this.state.name !== null && this.state.email !== null;
  }

  /**
   * Property snapshot
   *
   * @description
   * The state to store.
   *
   * @type {DirectoryUserState}
   * @readonly
   */
  public get snapshot(): DirectoryUserState {
    return this.state;
  }
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps a checked state.
   *
   * @param {DirectoryUserState} state - The checked state.
   * @constructor
   */
  private constructor(state: DirectoryUserState) {
    this.state = state;
  }
  // #endregion

  // #region Methods
  /**
   * Method unknown
   *
   * @description
   * The entry of an account no event was applied to yet.
   *
   * @param {string} userId - Id of the account.
   * @returns {DirectoryUser} An entry without name or address, at version 0 for both.
   */
  public static unknown(userId: string): DirectoryUser {
    return new DirectoryUser({
      userId,
      name: null,
      nameVersion: 0,
      email: null,
      emailVerified: false,
      emailVersion: 0,
    });
  }

  /**
   * Method restore
   *
   * @description
   * Rebuilds a stored entry.
   *
   * @param {DirectoryUserState} state - The stored state.
   * @returns {DirectoryUser} The entry.
   * @throws {InvalidStoredStateError} When a version is negative or a verified address is missing.
   */
  public static restore(state: DirectoryUserState): DirectoryUser {
    if (state.nameVersion < 0 || state.emailVersion < 0) {
      throw new InvalidStoredStateError('directory entry', 'the versions are not negative');
    }
    if (state.emailVerified && state.email === null) {
      throw new InvalidStoredStateError('directory entry', 'a verified address is known');
    }
    return new DirectoryUser(state);
  }

  /**
   * Method applySignUp
   *
   * @description
   * Applies `user.signed-up.v1`: the name and the address, not verified yet, each when the version
   * is newer than the one that last set it.
   *
   * @param {number} version - Version of the account after the sign-up.
   * @param {EmailAddress} email - The address signed up.
   * @param {string} name - The name typed at the sign-up.
   * @returns {DirectoryUser} The entry after the event.
   */
  public applySignUp(version: number, email: EmailAddress, name: string): DirectoryUser {
    return this.withName(version, name).withEmail(version, email, false);
  }

  /**
   * Method applyEmailVerification
   *
   * @description
   * Applies `user.email-verified.v1`: the verified address, when the version is newer.
   *
   * @param {number} version - Version of the account after the verification.
   * @param {EmailAddress} email - The verified address.
   * @returns {DirectoryUser} The entry after the event.
   */
  public applyEmailVerification(version: number, email: EmailAddress): DirectoryUser {
    return this.withEmail(version, email, true);
  }

  /**
   * Method applyProfileUpdate
   *
   * @description
   * Applies `user.profile-updated.v1`: the name, when the version is newer. The address is not
   * part of the profile.
   *
   * @param {number} version - Version of the account after the change.
   * @param {string} name - The full name after the change.
   * @returns {DirectoryUser} The entry after the event.
   */
  public applyProfileUpdate(version: number, name: string): DirectoryUser {
    return this.withName(version, name);
  }

  /**
   * Method withName
   *
   * @description
   * Sets the name for a newer version.
   *
   * @param {number} version - Version of the account that carries it.
   * @param {string} name - The name.
   * @returns {DirectoryUser} The entry, or this one for a version already applied.
   */
  private withName(version: number, name: string): DirectoryUser {
    if (version <= this.state.nameVersion) {
      return this;
    }
    return new DirectoryUser({ ...this.state, name, nameVersion: version });
  }

  /**
   * Method withEmail
   *
   * @description
   * Sets the address and its verification for a newer version.
   *
   * @param {number} version - Version of the account that carries it.
   * @param {EmailAddress} email - The address.
   * @param {boolean} verified - Whether a code proved it.
   * @returns {DirectoryUser} The entry, or this one for a version already applied.
   */
  private withEmail(version: number, email: EmailAddress, verified: boolean): DirectoryUser {
    if (version <= this.state.emailVersion) {
      return this;
    }
    return new DirectoryUser({
      ...this.state,
      email: email.value,
      emailVerified: verified,
      emailVersion: version,
    });
  }
  // #endregion
}
