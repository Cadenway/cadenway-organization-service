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

import type { InvitationStatus } from '../../../../../domain/value-objects/invitations/invitation-status.value-object.js';
import type { AssignableRole } from '../../../../../domain/value-objects/members/assignable-role.value-object.js';
import { organizations } from '../organizations/organization.schema.js';

/**
 * Table `invitations`: the invitations of addresses to join an organization. `email` is trimmed and
 * lowercased; one pending invitation at most per organization and address, by a partial unique
 * index, which also decides concurrent invitations of one address. `invitations_email_pending_index`
 * serves the invitations addressed to an account, a system query (a bounded exception of
 * `MODULE.md`). Row-level security on `organization_id`, forced by the migration.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    email: text('email').notNull(),
    role: text('role').$type<AssignableRole>().notNull(),
    invitedByUserId: uuid('invited_by_user_id').notNull(),
    status: text('status').$type<InvitationStatus>().notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invitations_organization_email_pending_unique')
      .on(table.organizationId, table.email)
      .where(sql`${table.status} = 'pending'`),
    index('invitations_organization_pending_index')
      .on(table.organizationId, table.sentAt.desc(), table.id.desc())
      .where(sql`${table.status} = 'pending'`),
    index('invitations_email_pending_index')
      .on(table.email, table.sentAt.desc(), table.id.desc())
      .where(sql`${table.status} = 'pending'`),
    check('invitations_role_check', sql`${table.role} in ('admin', 'member', 'guest')`),
    check(
      'invitations_status_check',
      sql`${table.status} in ('pending', 'accepted', 'refused', 'revoked')`,
    ),
    check('invitations_email_check', sql`char_length(${table.email}) between 3 and 254`),
    check('invitations_expiry_check', sql`${table.expiresAt} > ${table.sentAt}`),
    check('invitations_version_check', sql`${table.version} >= 1`),
    organizationPolicy('invitations_organization_isolation'),
  ],
);
