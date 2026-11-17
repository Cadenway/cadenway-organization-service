import { DirectoryUser } from '../../../../../domain/aggregates/directory-user/directory-user.aggregate.js';
import type { directoryUsers } from '../../schemas/directory/directory-user.schema.js';

/**
 * Type DirectoryUserRow
 *
 * @description
 * A row of `directory_users`.
 *
 * @type {typeof directoryUsers.$inferSelect}
 */
export type DirectoryUserRow = typeof directoryUsers.$inferSelect;

/**
 * Function toDirectoryUser
 *
 * @description
 * Maps a row to the directory entry it stores; the search key of the name stays in the row.
 *
 * @param {DirectoryUserRow} row - The row.
 * @returns {DirectoryUser} The entry.
 */
export function toDirectoryUser(row: DirectoryUserRow): DirectoryUser {
  return DirectoryUser.restore({
    userId: row.userId,
    name: row.name,
    nameVersion: row.nameVersion,
    email: row.email,
    emailVerified: row.emailVerified,
    emailVersion: row.emailVersion,
    deleted: row.deleted,
  });
}
