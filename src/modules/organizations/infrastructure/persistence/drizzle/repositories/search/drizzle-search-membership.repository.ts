import type { TenantTransactionRunner } from '@cadenway/nest-common/database';

import type { SearchMembershipReader } from '../../../../../application/ports/outbound/persistence/search/search-membership-reader.port.js';
import { DrizzleMemberRepository } from '../members/drizzle-member.repository.js';

/** Uses the existing active-member lookup within the verified tenant snapshot. */
export class DrizzleSearchMembershipReader implements SearchMembershipReader {
  // #region Constructor
  /** Binds the tenant transaction runner. */
  public constructor(private readonly tenant: TenantTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Reads the active member of the request's organization. */
  public findActive(
    organizationId: string,
    actorUserId: string,
  ): ReturnType<SearchMembershipReader['findActive']> {
    return this.tenant.run(
      ({ db }) => new DrizzleMemberRepository(db).findActiveOfUser(organizationId, actorUserId),
      { readOnly: true, isolationLevel: 'repeatable read' },
    );
  }
  // #endregion
}
