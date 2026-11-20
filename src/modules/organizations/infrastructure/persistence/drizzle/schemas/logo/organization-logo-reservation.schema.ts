import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { OrganizationLogoReservationState } from '../../../../../domain/value-objects/logo/organization-logo-reservation-state.value-object.js';
import type { OrganizationLogoDeclaration } from '../../../../../domain/value-objects/logo/organization-logo-declaration.value-object.js';
import { organizations } from '../organizations/organization.schema.js';

/** Owner reservations and short-lived idempotency claims for opaque logo uploads. */
export const organizationLogoReservations = pgTable(
  'organization_logo_reservations',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    uploadId: uuid('upload_id').notNull(),
    uploaderUserId: uuid('uploader_user_id').notNull(),
    generation: integer('generation').notNull(),
    contentType: text('content_type').$type<OrganizationLogoDeclaration['contentType']>().notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    state: text('state').$type<OrganizationLogoReservationState['state']>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }).notNull(),
    requestKeyDigest: text('request_key_digest'),
    requestKeyExpiresAt: timestamp('request_key_expires_at', { withTimezone: true, precision: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'organization_logo_reservations_pkey',
      columns: [table.organizationId, table.uploadId],
    }),
    uniqueIndex('organization_logo_reservations_actor_key_unique')
      .on(table.organizationId, table.uploaderUserId, table.requestKeyDigest)
      .where(sql`${table.requestKeyDigest} is not null`),
    index('organization_logo_reservations_pending_expiry_index')
      .on(table.expiresAt, table.organizationId, table.uploadId)
      .where(sql`${table.state} = 'pending'`),
    check('organization_logo_reservations_generation_check', sql`${table.generation} >= 0`),
    check(
      'organization_logo_reservations_size_check',
      sql`${table.sizeBytes} between 1 and 5242880`,
    ),
    check(
      'organization_logo_reservations_content_type_check',
      sql`${table.contentType} in ('image/png', 'image/svg+xml')`,
    ),
    check(
      'organization_logo_reservations_state_check',
      sql`${table.state} in ('pending', 'committed', 'expired', 'superseded')`,
    ),
    check(
      'organization_logo_reservations_receipt_check',
      sql`(${table.requestKeyDigest} is null) = (${table.requestKeyExpiresAt} is null)`,
    ),
    organizationPolicy('organization_logo_reservations_organization_isolation'),
  ],
);
