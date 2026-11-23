import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { DirectoryRepository } from '../../../../../application/ports/outbound/persistence/directory/directory-repository.port.js';
import type { DirectoryUser } from '../../../../../domain/aggregates/directory-user/directory-user.aggregate.js';
import type { DirectoryUserState } from '../../../../../domain/value-objects/directory/directory-user-state.value-object.js';
import { searchKeyOf } from '../../../../../domain/value-objects/search/search-key.value-object.js';
import { toDirectoryUser } from '../../mappers/directory/directory-user.mapper.js';
import type { DirectoryUserRow } from '../../mappers/directory/directory-user.mapper.js';
import { directoryUsers } from '../../schemas/directory/directory-user.schema.js';

/**
 * Class DrizzleDirectoryRepository
 *
 * @description
 * `DirectoryRepository` on `directory_users`, in the transaction of its unit of work. The table
 * carries no organization and no policy: every query names its account.
 */
export class DrizzleDirectoryRepository implements DirectoryRepository {
  // #region Properties
  /**
   * Property db
   *
   * @description
   * The Drizzle database of the transaction.
   *
   * @type {TransactionDatabase}
   * @readonly
   */
  private readonly db: TransactionDatabase;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Binds the repository to a transaction.
   *
   * @param {TransactionDatabase} db - The Drizzle database of the transaction.
   * @constructor
   */
  public constructor(db: TransactionDatabase) {
    this.db = db;
  }
  // #endregion

  // #region Methods
  /**
   * Method find
   *
   * @description
   * Loads the entry of an account.
   *
   * @param {string} userId - The account.
   * @returns {Promise<DirectoryUser | null>} The entry, or `null`.
   */
  public async find(userId: string): Promise<DirectoryUser | null> {
    const rows: DirectoryUserRow[] = await this.db
      .select()
      .from(directoryUsers)
      .where(eq(directoryUsers.userId, userId))
      .limit(1);
    const row: DirectoryUserRow | undefined = rows[0];
    return row === undefined ? null : toDirectoryUser(row);
  }

  /**
   * Method findForShare
   *
   * @description
   * Loads the entry of an account with `select … for share`, which waits for a projection that
   * holds it (`for update`) and keeps the next one waiting until the end of the transaction.
   *
   * @param {string} userId - The account.
   * @returns {Promise<DirectoryUser | null>} The entry, or `null`.
   */
  public async findForShare(userId: string): Promise<DirectoryUser | null> {
    const rows: DirectoryUserRow[] = await this.db
      .select()
      .from(directoryUsers)
      .where(eq(directoryUsers.userId, userId))
      .limit(1)
      .for('share');
    const row: DirectoryUserRow | undefined = rows[0];
    return row === undefined ? null : toDirectoryUser(row);
  }

  /**
   * Method lock
   *
   * @description
   * Creates the empty entry of an account unless it exists, then loads and locks it: two
   * concurrent events of a new account both find the row, the second waits for the first.
   *
   * @param {string} userId - The account.
   * @returns {Promise<DirectoryUser>} The locked entry.
   * @throws {Error} When the row cannot be read back, which never happens after the insert.
   */
  public async lock(userId: string): Promise<DirectoryUser> {
    await this.db.insert(directoryUsers).values({ userId }).onConflictDoNothing();
    const rows: DirectoryUserRow[] = await this.db
      .select()
      .from(directoryUsers)
      .where(eq(directoryUsers.userId, userId))
      .limit(1)
      .for('update');
    const row: DirectoryUserRow | undefined = rows[0];
    if (row === undefined) {
      throw new Error('The directory entry of an account cannot be read back.');
    }
    return toDirectoryUser(row);
  }

  /** Acquires the exclusive directory lock without creating a row. */
  public async findForUpdate(userId: string): Promise<DirectoryUser | null> {
    const [row] = await this.db
      .select()
      .from(directoryUsers)
      .where(eq(directoryUsers.userId, userId))
      .for('update');
    return row === undefined ? null : toDirectoryUser(row);
  }

  /** Reads the reservation while the caller holds a shared or exclusive directory lock. */
  public async findDeletionAttempt(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ attemptId: directoryUsers.deletionAttemptId })
      .from(directoryUsers)
      .where(eq(directoryUsers.userId, userId));
    return row?.attemptId ?? null;
  }

  /** Writes the first reservation without replacing a different attempt. */
  public async reserveDeletion(userId: string, attemptId: string): Promise<void> {
    const changed = await this.db
      .update(directoryUsers)
      .set({ deletionAttemptId: attemptId })
      .where(
        and(
          eq(directoryUsers.userId, userId),
          eq(directoryUsers.deleted, false),
          isNull(directoryUsers.deletionAttemptId),
        ),
      )
      .returning({ userId: directoryUsers.userId });
    if (changed.length !== 1)
      throw new Error('The locked account cannot be reserved for deletion.');
  }

  /**
   * Method save
   *
   * @description
   * Writes a locked entry, with the search key of its name; a deleted account keeps neither.
   *
   * @param {DirectoryUser} user - The entry after the event.
   * @returns {Promise<void>} Resolves once written.
   */
  public async save(user: DirectoryUser): Promise<void> {
    const state: DirectoryUserState = user.snapshot;
    await this.db
      .update(directoryUsers)
      .set({
        name: state.name,
        nameKey: state.name === null ? null : searchKeyOf(state.name),
        nameVersion: state.nameVersion,
        email: state.email,
        emailVerified: state.emailVerified,
        emailVersion: state.emailVersion,
        twoStepVerificationEnabled: state.twoStepVerificationEnabled,
        twoStepVerificationVersion: state.twoStepVerificationVersion,
        deleted: state.deleted,
        deletionAttemptId: state.deleted ? null : undefined,
        updatedAt: sql`now()`,
      })
      .where(eq(directoryUsers.userId, state.userId));
  }
  // #endregion
}
