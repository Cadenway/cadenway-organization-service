import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { Role } from '../../../../../domain/value-objects/members/role.value-object.js';
import { organizations } from '../organizations/organization.schema.js';

/**
 * Table `members`: the memberships of the organizations. `user_id` names an account of
 * identity-service, never a foreign key into another service. A removed membership is kept with
 * `removed_at` and its last version; at most one active membership per account and organization,
 * and one active owner per organization, both by partial unique indexes. `organization_id` comes
 * first in every index a tenant query uses; `members_user_active_index` serves the list of the
 * organizations of an account, a system query (a bounded exception of `MODULE.md`). Row-level
 * security on `organization_id`, forced by the migration.
 */
export const members = pgTable(
  'members',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id').notNull(),
    role: text('role').$type<Role>().notNull(),
    invitationId: uuid('invitation_id'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('members_organization_user_active_unique')
      .on(table.organizationId, table.userId)
      .where(sql`${table.removedAt} is null`),
    uniqueIndex('members_organization_owner_unique')
      .on(table.organizationId)
      .where(sql`${table.role} = 'owner' and ${table.removedAt} is null`),
    index('members_user_active_index')
      .on(table.userId)
      .where(sql`${table.removedAt} is null`),
    check('members_role_check', sql`${table.role} in ('owner', 'admin', 'member', 'guest')`),
    check('members_version_check', sql`${table.version} >= 1`),
    organizationPolicy('members_organization_isolation'),
  ],
);
