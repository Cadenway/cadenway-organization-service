import { requireOrganizationId } from '@cadenway/nest-common';
import type { TransactionDatabase } from '@cadenway/nest-common/database';
import { and, eq, lte, lt } from 'drizzle-orm';

import type { SeatEntitlementRepository } from '../../../../../application/ports/outbound/persistence/billing/seat-entitlement-repository.port.js';
import type { SeatEntitlement } from '../../../../../domain/value-objects/billing/seat-entitlement.value-object.js';
import { organizationSeatEntitlements } from '../../schemas/billing/organization-seat-entitlement.schema.js';

/** Stores the current seat entitlement in the caller's tenant transaction. */
export class DrizzleSeatEntitlementRepository implements SeatEntitlementRepository {
  // #region Constructor
  /** Binds all reads and writes to the caller's existing transaction. */
  public constructor(private readonly db: TransactionDatabase) {}
  // #endregion

  // #region Methods
  /** Returns the committed projection, or null before the first Billing update. */
  public async find(organizationId: string): Promise<SeatEntitlement | null> {
    this.assertTenant(organizationId);
    const rows = await this.db
      .select({
        plan: organizationSeatEntitlements.plan,
        seatLimit: organizationSeatEntitlements.seatLimit,
        version: organizationSeatEntitlements.version,
      })
      .from(organizationSeatEntitlements)
      .where(eq(organizationSeatEntitlements.organizationId, organizationId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Atomically accepts a newer projection whose seat limit does not decrease. */
  public async writeNext(organizationId: string, entitlement: SeatEntitlement): Promise<boolean> {
    this.assertTenant(organizationId);
    const rows = await this.db
      .insert(organizationSeatEntitlements)
      .values({ organizationId, ...entitlement })
      .onConflictDoUpdate({
        target: organizationSeatEntitlements.organizationId,
        set: {
          plan: entitlement.plan,
          seatLimit: entitlement.seatLimit,
          version: entitlement.version,
          updatedAt: new Date(),
        },
        setWhere: and(
          lt(organizationSeatEntitlements.version, entitlement.version),
          lte(organizationSeatEntitlements.seatLimit, entitlement.seatLimit),
        ),
      })
      .returning({ organizationId: organizationSeatEntitlements.organizationId });
    return rows.length === 1;
  }

  /** Rejects attempts to name a tenant other than the transaction's verified tenant. */
  private assertTenant(organizationId: string): void {
    if (requireOrganizationId() !== organizationId) {
      throw new Error('Seat entitlement organization does not match the current tenant.');
    }
  }
  // #endregion
}
