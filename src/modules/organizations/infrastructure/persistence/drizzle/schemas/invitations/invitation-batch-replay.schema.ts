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
import type { InvitationBatchRequestState } from '../../../../../domain/value-objects/invitations/invitation-batch-request.value-object.js';
import { organizations } from '../organizations/organization.schema.js';

/**
 * Table `invitation_batch_replays`: the `200` outcome of each invitation batch sent with an
 * `Idempotency-Key`, replayed until `expires_at` (24 hours). The key is scoped to the organization
 * and the acting user by the primary key, and kept as its SHA-256 digest only; the table is
 * dedicated to `inviteMembers`, which scopes it to the operation. `request` holds the canonical batch
 * (distinct addresses in order and the role) the equivalence is decided on, `outcome` the body to
 * replay. Each keyed batch of an organization deletes its expired rows under the lock of the
 * allowance, by `invitation_batch_replays_organization_expiry_index`. Row-level security on
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
    request: jsonb('request').$type<InvitationBatchRequestState>().notNull(),
    outcome: jsonb('outcome').$type<readonly InvitationOutcome[]>().notNull(),
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
    check('invitation_batch_replays_key_digest_check', sql`${table.keyDigest} ~ '^[0-9a-f]{64}$'`),
    organizationPolicy('invitation_batch_replays_organization_isolation'),
  ],
);
