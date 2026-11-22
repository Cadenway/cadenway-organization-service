import { sql } from 'drizzle-orm';
import { index, pgPolicy, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

const senderScope = sql`sender_id = nullif(current_setting('app.invitation_sender_id', true), '')::uuid`;

/** Cross-organization invitation allowance. Contains no recipient, invitation or tenant ID. */
export const invitationSenderEmails = pgTable(
  'invitation_sender_emails',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    senderId: uuid('sender_id').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('invitation_sender_emails_sender_sent_index').on(table.senderId, table.sentAt),
    pgPolicy('invitation_sender_emails_sender_isolation', {
      for: 'all',
      using: senderScope,
      withCheck: senderScope,
    }),
  ],
);
