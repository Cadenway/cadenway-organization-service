import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { SEAT_ROLES } from '../../../../../domain/policies/members/seat.policy.js';
import { members } from '../../schemas/members/member.schema.js';

/**
 * Function toSeatCount
 *
 * @description
 * The scalar subquery that counts the active members of an organization that take a seat
 * (`SEAT_ROLES`: guests excluded), for the `memberCount` of a list row.
 *
 * @param {TransactionDatabase} db - The Drizzle database of the transaction.
 * @param {AnyColumn} organizationId - The column of the outer query that names the organization.
 * @returns {SQL<number>} The subquery, as an integer.
 */
export function toSeatCount(db: TransactionDatabase, organizationId: AnyColumn): SQL<number> {
  const seat = alias(members, 'seat');
  return sql<number>`(${db
    .select({ count: sql<number>`count(*)::int` })
    .from(seat)
    .where(
      and(
        eq(seat.organizationId, organizationId),
        isNull(seat.removedAt),
        inArray(seat.role, [...SEAT_ROLES]),
      ),
    )})`;
}
