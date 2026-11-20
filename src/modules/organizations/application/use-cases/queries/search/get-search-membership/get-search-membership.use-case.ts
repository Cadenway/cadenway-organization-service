import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { SearchMembershipReader } from '../../../../ports/outbound/persistence/search/search-membership-reader.port.js';
import type { GetSearchMembershipInput } from './get-search-membership.input.js';
import type { GetSearchMembershipOutput } from './get-search-membership.output.js';

/** Reads only the stamp needed to match the current membership in Task. */
export class GetSearchMembership {
  // #region Constructor
  /** Binds an active membership reader. */
  public constructor(private readonly memberships: SearchMembershipReader) {}
  // #endregion

  // #region Methods
  /** Proves current membership for the verified tenant and actor. */
  public async execute(input: GetSearchMembershipInput): Promise<GetSearchMembershipOutput> {
    const membership = await this.memberships.findActive(input.organizationId, input.actorUserId);
    if (membership === null) {
      throw new OrganizationRefusal({ reason: 'organization-not-found' });
    }
    const { id, role, version } = membership.snapshot;
    return { memberId: id, role, version };
  }
  // #endregion
}
