import type { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { AutomationRecipientReader } from '../../../../../application/ports/outbound/persistence/automation/automation-recipient-reader.port.js';
import { members } from '../../schemas/members/member.schema.js';

/** Reads current caller and recipient memberships from the same tenant snapshot. */
export class DrizzleAutomationRecipientReader implements AutomationRecipientReader {
  // #region Constructor
  /** Uses the same tenant transaction policy as the other authority reads. */
  public constructor(private readonly tenant: TenantTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Selects at most the two active memberships needed to build the decision. */
  public read(
    organizationId: string,
    actorUserId: string,
    userId: string,
  ): ReturnType<AutomationRecipientReader['read']> {
    const actor = actorUserId.toLowerCase();
    const recipient = userId.toLowerCase();
    return this.tenant.run(
      async ({ db, organizationId: tenantId }) => {
        if (tenantId !== organizationId) throw new Error('Automation recipient tenant mismatch.');
        const active = await db
          .select({ userId: members.userId, role: members.role })
          .from(members)
          .where(
            and(
              eq(members.organizationId, organizationId),
              isNull(members.removedAt),
              inArray(members.userId, [actor, recipient]),
            ),
          )
          .limit(2);
        return {
          actorRole: active.find((member) => member.userId === actor)?.role ?? null,
          eligible: active.some((member) => member.userId === recipient),
        };
      },
      { readOnly: true },
    );
  }
  // #endregion
}
