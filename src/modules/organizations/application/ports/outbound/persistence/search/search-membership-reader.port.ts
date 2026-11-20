import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';

/** Loads the actor's active membership from the verified tenant. */
export interface SearchMembershipReader {
  // #region Methods
  /** Reads the active membership of the signed user in the signed organization. */
  findActive(organizationId: string, actorUserId: string): Promise<Member | null>;
  // #endregion
}
