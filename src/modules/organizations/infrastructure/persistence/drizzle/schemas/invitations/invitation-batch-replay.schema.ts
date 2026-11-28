import { organizationPolicy } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import type { InvitationOutcome } from '../../../../../application/projections/invitations/invitation-outcome.projection.js';
import { organizations } from '../organizations/organization.schema.js';

/**
 * Table `invitation_batch_replays`: one row per `Idempotency-Key` of an invitation batch, scoped to
 * the organization and the acting user by the primary key and kept as its SHA-256 digest only; the
 * table is dedicated to `inviteMembers`, which scopes it to the operation. A row is first a
 * `reserved` key, taken in a short transaction of its own before the batch runs, with a `lease_id`
 * and a 30-second lease in `expires_at`: it makes another batch under the key answer `409` (the
 * same batch) or `422` (another one) at once, and a lease that ran out (a crashed holder) can be
 * taken over. The batch's own transaction turns it into a `committed` record with its `outcome`,
 * replayed until `expires_at`, 24 hours later, together with the invitations; a failed batch
 * deletes it. `request_digest` is the SHA-256 fingerprint of the canonical batch, never the batch;
 * `outcome` lists the invited addresses, kept until the row is purged. A keyed batch deletes a
 * bounded number of its organization's expired rows
 * (`invitation_batch_replays_organization_expiry_index`), and the
 * `organization.purge-invitation-batch-replays` job deletes expired rows, leases included, of every
 * organization in bounded batches (`invitation_batch_replays_expiry_index`). The admission of a new
 * key counts the reservations of its organization and deletes those whose lease ran out and that
 * no transaction holds (`invitation_batch_replays_reservation_index`). Row-level security on
 * `organization_id`, forced by the migration.
 */
export const invitationBatchReplays = pgTable(
  'invitation_batch_replays',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    actorUserId: uuid('actor_user_id').notNull(),
    keyDigest: text('key_digest').notNull(),
    requestDigest: text('request_digest').notNull(),
    state: text('state').$type<'reserved' | 'committed'>().notNull(),
    leaseId: uuid('lease_id'),
    outcome: jsonb('outcome').$type<readonly InvitationOutcome[]>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'invitation_batch_replays_pkey',
      columns: [table.organizationId, table.actorUserId, table.keyDigest],
    }),
    index('invitation_batch_replays_organization_expiry_index').on(
      table.organizationId,
      table.expiresAt,
    ),
    index('invitation_batch_replays_expiry_index').on(table.expiresAt),
    // The reservations of an organization only, which its replay record budget counts and
    // reclaims under its admission lock without scanning its records.
    index('invitation_batch_replays_reservation_index')
      .on(table.organizationId, table.expiresAt)
      .where(sql`${table.state} = 'reserved'`),
    check('invitation_batch_replays_key_digest_check', sql`${table.keyDigest} ~ '^[0-9a-f]{64}$'`),
    check(
      'invitation_batch_replays_request_digest_check',
      sql`${table.requestDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'invitation_batch_replays_state_check',
      sql`(${table.state} = 'reserved' and ${table.leaseId} is not null and ${table.outcome} is null) or (${table.state} = 'committed' and ${table.leaseId} is null and ${table.outcome} is not null)`,
    ),
    organizationPolicy('invitation_batch_replays_organization_isolation'),
  ],
);
