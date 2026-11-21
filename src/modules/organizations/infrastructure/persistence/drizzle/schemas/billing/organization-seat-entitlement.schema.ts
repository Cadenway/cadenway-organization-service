import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organizations } from '../organizations/organization.schema.js';

/** Last committed Billing seat entitlement projected for an organization. */
export const organizationSeatEntitlements = pgTable(
  'organization_seat_entitlements',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    plan: text('plan').notNull(),
    seatLimit: bigint('seat_limit', { mode: 'number' }).notNull(),
    version: bigint('version', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('organization_seat_entitlements_plan_check', sql`char_length(${table.plan}) > 0`),
    check(
      'organization_seat_entitlements_limit_check',
      sql`${table.seatLimit} between 5 and 9007199254740991`,
    ),
    check(
      'organization_seat_entitlements_version_check',
      sql`${table.version} between 1 and 9007199254740991`,
    ),
    organizationPolicy('organization_seat_entitlements_organization_isolation'),
  ],
);
