import type { Role } from '../../../../../domain/value-objects/members/role.value-object.js';

/** Current identity, role and version of the actor's active membership. */
export interface GetSearchMembershipOutput {
  // #region Properties
  /** Active membership aggregate ID. */
  readonly memberId: string;

  /** Role read from the active membership. */
  readonly role: Role;

  /** Version of the membership aggregate. */
  readonly version: number;
  // #endregion
}
