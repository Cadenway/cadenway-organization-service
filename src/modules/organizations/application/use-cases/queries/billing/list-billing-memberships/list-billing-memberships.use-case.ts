import type { BillingMembershipsReader } from '../../../../ports/outbound/persistence/billing/billing-memberships-reader.port.js';
import type { ListBillingMembershipsInput } from './list-billing-memberships.input.js';
import type { ListBillingMembershipsOutput } from './list-billing-memberships.output.js';

/** Lists versioned membership observations for a Billing reconstruction. */
export class ListBillingMemberships {
  // #region Constructor
  /** Binds the tenant-scoped snapshot reader. */
  public constructor(private readonly reader: BillingMembershipsReader) {}
  // #endregion

  // #region Methods
  /** Returns null for a missing organization and a continuation only when another row exists. */
  public async execute(
    input: ListBillingMembershipsInput,
  ): Promise<ListBillingMembershipsOutput | null> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new RangeError('The Billing membership page size must be 1 to 100.');
    }

    const result = await this.reader.read(input.organizationId, input.position, input.limit + 1);
    if (result === null) return null;

    const items = result.items.slice(0, input.limit);
    const afterId = items.at(-1)?.memberId;
    const nextPosition =
      result.items.length > input.limit && result.upperId !== null && afterId !== undefined
        ? { upperId: result.upperId, afterId }
        : null;
    return { items, nextPosition };
  }
  // #endregion
}
