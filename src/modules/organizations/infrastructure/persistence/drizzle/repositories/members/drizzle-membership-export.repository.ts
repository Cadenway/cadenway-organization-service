import type { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { asc, sql } from 'drizzle-orm';

import { members } from '../../schemas/members/member.schema.js';

const membershipColumns = {
  organizationId: members.organizationId,
  memberId: members.id,
  userId: members.userId,
  role: members.role,
  version: members.version,
  removedAt: members.removedAt,
  updatedAt: members.updatedAt,
} as const;

type MembershipRow = Pick<
  typeof members.$inferSelect,
  'organizationId' | 'userId' | 'role' | 'version' | 'removedAt' | 'updatedAt'
> & { readonly memberId: string };

const pageSize = 500;

/** Streams only membership identity and state from one read-only PostgreSQL snapshot. */
export class DrizzleMembershipExport {
  // #region Constructor
  /** Binds the system reader of the Organization database. */
  public constructor(private readonly system: SystemTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Awaits each page write before fetching the next one and returns the committed row count. */
  public export(write: (page: readonly MembershipRow[]) => Promise<void>): Promise<number> {
    return this.system.run(
      async ({ db }) => {
        let after: MembershipRow | undefined;
        let count = 0;
        for (;;) {
          const page: MembershipRow[] = await db
            .select(membershipColumns)
            .from(members)
            .where(
              after === undefined
                ? undefined
                : sql`(${members.organizationId}, ${members.id}) > (${after.organizationId}::uuid, ${after.memberId}::uuid)`,
            )
            .orderBy(asc(members.organizationId), asc(members.id))
            .limit(pageSize);
          if (page.length === 0) return count;
          await write(page);
          count += page.length;
          if (page.length < pageSize) return count;
          after = page.at(-1);
        }
      },
      { readOnly: true, isolationLevel: 'repeatable read', maxAttempts: 1 },
    );
  }
  // #endregion
}
