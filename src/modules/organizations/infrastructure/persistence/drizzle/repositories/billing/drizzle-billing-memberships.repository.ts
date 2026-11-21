import type { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { and, asc, desc, eq, gt, lte } from 'drizzle-orm';

import type { BillingMembershipPosition } from '../../../../../application/models/billing/billing-membership-position.model.js';
import type { BillingMembershipsReader } from '../../../../../application/ports/outbound/persistence/billing/billing-memberships-reader.port.js';
import type { BillingMembershipProjection } from '../../../../../application/projections/billing/billing-membership.projection.js';
import { members } from '../../schemas/members/member.schema.js';
import { organizations } from '../../schemas/organizations/organization.schema.js';

const MAX_PAGE_WITH_LOOKAHEAD = 101;

/** Reads the versioned active and removed memberships for one organization. */
export class DrizzleBillingMembershipsReader implements BillingMembershipsReader {
  // #region Constructor
  /** Binds the tenant runner used for the organization snapshot. */
  public constructor(private readonly tenant: TenantTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Fixes the inclusive upper member ID on the first page and resumes after the last ID. */
  public read(
    organizationId: string,
    position: BillingMembershipPosition | null,
    maximum: number,
  ): ReturnType<BillingMembershipsReader['read']> {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_PAGE_WITH_LOOKAHEAD) {
      return Promise.reject(new Error('The Billing membership page exceeds its bound.'));
    }

    return this.tenant.run(
      async ({ db, organizationId: tenantId }) => {
        if (tenantId !== organizationId) throw new Error('Billing membership tenant mismatch.');
        const organization = await db
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1);
        if (organization.length === 0) return null;

        const upperId =
          position?.upperId ??
          (
            await db
              .select({ id: members.id })
              .from(members)
              .where(eq(members.organizationId, organizationId))
              .orderBy(desc(members.id))
              .limit(1)
          )[0]?.id ??
          null;
        if (upperId === null) return { upperId, items: [] };

        const rows = await db
          .select({
            memberId: members.id,
            version: members.version,
            role: members.role,
            removedAt: members.removedAt,
          })
          .from(members)
          .where(
            and(
              eq(members.organizationId, organizationId),
              lte(members.id, upperId),
              position === null ? undefined : gt(members.id, position.afterId),
            ),
          )
          .orderBy(asc(members.id))
          .limit(maximum);
        const items: BillingMembershipProjection[] = rows.map((row) =>
          row.removedAt === null
            ? { memberId: row.memberId, state: 'active', role: row.role, version: row.version }
            : { memberId: row.memberId, state: 'removed', version: row.version },
        );
        return { upperId, items };
      },
      { readOnly: true, isolationLevel: 'repeatable read' },
    );
  }
  // #endregion
}
