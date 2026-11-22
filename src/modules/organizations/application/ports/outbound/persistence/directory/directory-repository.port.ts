import type { DirectoryUser } from '../../../../../domain/aggregates/directory-user/directory-user.aggregate.js';

/**
 * Interface DirectoryRepository
 *
 * @description
 * The user directory, bound to the transaction of a unit of work. An entry belongs to no
 * organization: every method names its account.
 */
export interface DirectoryRepository {
  // #region Methods
  /**
   * Method find
   *
   * @description
   * Loads the entry of an account without a lock.
   *
   * @param {string} userId - The account.
   * @returns {Promise<DirectoryUser | null>} The entry, or `null` when no event of it was applied.
   */
  find(userId: string): Promise<DirectoryUser | null>;

  /**
   * Method findForShare
   *
   * @description
   * Loads the entry of an account and locks it in share mode until the end of the transaction,
   * without creating it: the projection of an event of the account (`lock`), such as its deletion,
   * waits for the transaction, and a projection under way is waited for, then read once committed.
   * For the writes that give the account a membership, so a deletion never misses one.
   *
   * @param {string} userId - The account.
   * @returns {Promise<DirectoryUser | null>} The entry, or `null` when no event of it was applied.
   */
  findForShare(userId: string): Promise<DirectoryUser | null>;

  /**
   * Method lock
   *
   * @description
   * Loads the entry of an account and locks it until the end of the transaction, creating an empty
   * one first when none exists, so that two events of one account apply one after the other.
   *
   * @param {string} userId - The account.
   * @returns {Promise<DirectoryUser>} The locked entry.
   */
  lock(userId: string): Promise<DirectoryUser>;

  /** Locks an existing account against granting new memberships, without creating an entry. */
  findForUpdate(userId: string): Promise<DirectoryUser | null>;

  /** Reads the deletion attempt already reserved under the held directory row lock. */
  findDeletionAttempt(userId: string): Promise<string | null>;

  /** Stores the first deletion attempt under the exclusive directory row lock. */
  reserveDeletion(userId: string, attemptId: string): Promise<void>;

  /**
   * Method save
   *
   * @description
   * Writes an entry locked by `lock`.
   *
   * @param {DirectoryUser} user - The entry after the event.
   * @returns {Promise<void>} Resolves once written.
   */
  save(user: DirectoryUser): Promise<void>;
  // #endregion
}
