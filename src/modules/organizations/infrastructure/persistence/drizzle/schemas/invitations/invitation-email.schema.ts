import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organizations } from '../organizations/organization.schema.js';
import { invitations } from './invitation.schema.js';

/**
 * Table `invitation_emails`: the ledger of the invitation emails each organization caused, one row
 * per issue (from a batch or from the creation of the organization) and per resend, for the daily
 * allowance of decision 1 of the P2b security follow-ups. `invitations.sent_at` cannot count them,
 * since a resend overwrites it. A row is written once and never changed, so it has no `version`
 * nor `updated_at`; it holds no address. The rows of an organization that left the 24 hours are
 * deleted by its next batch or resend, so the table keeps 100 rows at most per organization.
 * `invitation_emails_organization_sent_at_index` serves the count of the window. Row-level security
 * on `organization_id`, forced by the migration.
 */
export const invitationEmails = pgTable(
  'invitation_emails',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    invitationId: uuid('invitation_id')
      .notNull()
      .references(() => invitations.id),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('invitation_emails_organization_sent_at_index').on(table.organizationId, table.sentAt),
    organizationPolicy('invitation_emails_organization_isolation'),
  ],
);
