import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';

import type { QuotaNotificationRecipientsReader } from '../../../../../application/ports/outbound/queries/quota-notifications/quota-notification-recipients-reader.port.js';
import { members } from '../../schemas/members/member.schema.js';

const MAX_LOOKUP_USERS = 100;
const MAX_PAGE_WITH_LOOKAHEAD = 101;

/** Reads eligible quota alert recipients in the caller's tenant transaction. */
export class DrizzleQuotaNotificationRecipientsReader implements QuotaNotificationRecipientsReader {
  // #region Constructor
  /** Binds the reader to a tenant-scoped transaction. */
  public constructor(private readonly db: TransactionDatabase) {}
  // #endregion

  // #region Methods
  /** Lists current owners and administrators by immutable user ID, with bounded lookahead. */
  public async listActive(
    organizationId: string,
    afterUserId: string | null,
    limit: number,
  ): Promise<readonly string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_WITH_LOOKAHEAD) {
      throw new Error('The quota notification recipient page exceeds its bound.');
    }

    const rows = await this.db
      .select({ userId: members.userId })
      .from(members)
      .where(
        and(
          eq(members.organizationId, organizationId),
          isNull(members.removedAt),
          inArray(members.role, ['owner', 'admin']),
          afterUserId === null ? undefined : gt(members.userId, afterUserId),
        ),
      )
      .orderBy(asc(members.userId))
      .limit(limit);
    return rows.map(({ userId }) => userId);
  }

  /** Rechecks current tenant roles for a bounded list of user IDs. */
  public async findActive(
    organizationId: string,
    userIds: readonly string[],
  ): Promise<readonly string[]> {
    if (userIds.length > MAX_LOOKUP_USERS) {
      throw new Error('The quota notification recipient lookup exceeds its bound.');
    }
    if (userIds.length === 0) return [];

    const rows = await this.db
      .select({ userId: members.userId })
      .from(members)
      .where(
        and(
          eq(members.organizationId, organizationId),
          isNull(members.removedAt),
          inArray(members.role, ['owner', 'admin']),
          inArray(members.userId, [...userIds]),
        ),
      )
      .orderBy(asc(members.userId))
      .limit(MAX_LOOKUP_USERS);
    return rows.map(({ userId }) => userId);
  }
  // #endregion
}
