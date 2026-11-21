import { decideSeatEntitlement } from '../../../../../domain/policies/members/seat-entitlement.policy.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { readSeatEntitlement } from '../../../../services/members/seat-limit.service.js';
import type { ApplySeatEntitlementInput } from './apply-seat-entitlement.input.js';
import type { ApplySeatEntitlementOutput } from './apply-seat-entitlement.output.js';

/** Projects verified Billing changes under the membership admission lock. */
export class ApplySeatEntitlement {
  // #region Constructor
  /** Takes the transaction port that binds seat reads and writes to the verified tenant. */
  public constructor(private readonly unitOfWork: OrganizationsUnitOfWork) {}
  // #endregion

  // #region Methods
  /**
   * Applies one Billing snapshot. The caller establishes its trusted tenant context.
   *
   * @param input - The verified tenant and the seat projection of the snapshot.
   * @returns Whether the committed projection advanced, was replayed, or was refused.
   */
  public execute(input: ApplySeatEntitlementInput): Promise<ApplySeatEntitlementOutput> {
    return this.unitOfWork.runInRequestOrganization(async (store) => {
      await store.members.lockSeatAdmission(input.organizationId);
      const current = await readSeatEntitlement(store, input.organizationId);
      const decision = decideSeatEntitlement(current, input.entitlement);
      if (decision !== 'advance') return decision;

      const applied = await store.seatEntitlements.writeNext(
        input.organizationId,
        input.entitlement,
      );
      if (!applied) throw new Error('Seat entitlement changed while the admission lock was held.');
      return 'applied';
    });
  }
  // #endregion
}
