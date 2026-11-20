import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { MemberNamesUnitOfWork } from '../../../../ports/outbound/transactions/organizations/member-names-unit-of-work.port.js';
import type { LookupMemberNamesInput } from './lookup-member-names.input.js';
import type { LookupMemberNamesOutput } from './lookup-member-names.output.js';

/** Reads requested member names after checking the caller's current membership. */
export class LookupMemberNames {
  // #region Constructor
  /** Binds authorization and target reads to one repeatable-read tenant snapshot. */
  public constructor(private readonly unitOfWork: MemberNamesUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Returns only existing names of active members, including for guest callers. */
  public async execute(input: LookupMemberNamesInput): Promise<LookupMemberNamesOutput> {
    return this.unitOfWork.read(async (reader): Promise<LookupMemberNamesOutput> => {
      const active = await reader.findActiveActor(input.organizationId, input.actorUserId);
      if (!active) {
        throw new OrganizationRefusal({ reason: 'organization-not-found' });
      }
      const userIds = [...new Set(input.userIds.map((userId) => userId.toLowerCase()))];
      return { items: await reader.findActiveNames(input.organizationId, userIds) };
    });
  }
  // #endregion
}
