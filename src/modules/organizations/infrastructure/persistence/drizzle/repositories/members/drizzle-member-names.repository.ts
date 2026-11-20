import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { MemberNamesReader } from '../../../../../application/ports/outbound/persistence/members/member-names-reader.port.js';
import type { MemberName } from '../../../../../application/projections/members/member-name.projection.js';
import { directoryUsers } from '../../schemas/directory/directory-user.schema.js';
import { members } from '../../schemas/members/member.schema.js';

const MAX_LOOKUP_ACCOUNTS = 5000;

/** Reads current tenant membership and directory names in the caller's transaction. */
export class DrizzleMemberNamesReader implements MemberNamesReader {
  // #region Constructor
  /** Binds both reads to the same tenant transaction. */
  public constructor(private readonly db: TransactionDatabase) {}
  // #endregion

  // #region Methods
  /** Checks active membership, including guests. */
  public async findActiveActor(organizationId: string, actorUserId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.organizationId, organizationId),
          eq(members.userId, actorUserId),
          isNull(members.removedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Selects only full names for the requested active members of this tenant. */
  public async findActiveNames(
    organizationId: string,
    userIds: readonly string[],
  ): Promise<readonly MemberName[]> {
    if (userIds.length > MAX_LOOKUP_ACCOUNTS) {
      throw new Error('A member name lookup exceeds the configured account bound.');
    }
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select({ userId: members.userId, name: directoryUsers.name })
      .from(members)
      .innerJoin(directoryUsers, eq(directoryUsers.userId, members.userId))
      .where(
        and(
          eq(members.organizationId, organizationId),
          inArray(members.userId, [...userIds]),
          isNull(members.removedAt),
          eq(directoryUsers.deleted, false),
        ),
      )
      .limit(MAX_LOOKUP_ACCOUNTS);
    return rows.flatMap((row) =>
      row.name === null || row.name.trim().length === 0
        ? []
        : [{ userId: row.userId, name: row.name }],
    );
  }
  // #endregion
}
