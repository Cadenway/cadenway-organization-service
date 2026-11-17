import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Table `directory_users`: the user directory, a projection of `user.signed-up.v1`,
 * `user.email-verified.v1` and `user.profile-updated.v1` of identity-service (decision 4 of P2b).
 * Keyed by the id of the account in identity-service, which assigned it: the one table of the
 * module without a `uuidv7()` id and without a `version`, since each part carries the version of
 * the account that set it (`name_version`, `email_version`). `name_key` is the search key of the
 * name. An account belongs to no organization: no `organization_id`, no policy; every query names
 * its account or its address.
 */
export const directoryUsers = pgTable(
  'directory_users',
  {
    userId: uuid('user_id').primaryKey(),
    name: text('name'),
    nameKey: text('name_key'),
    nameVersion: integer('name_version').notNull().default(0),
    email: text('email'),
    emailVerified: boolean('email_verified').notNull().default(false),
    emailVersion: integer('email_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('directory_users_email_index').on(table.email),
    check(
      'directory_users_versions_check',
      sql`${table.nameVersion} >= 0 and ${table.emailVersion} >= 0`,
    ),
    check(
      'directory_users_verified_email_check',
      sql`not ${table.emailVerified} or ${table.email} is not null`,
    ),
  ],
);
