import { describe, expect, it } from 'vitest';

import { FREE_SEAT_ENTITLEMENT } from '../../../../../domain/value-objects/billing/seat-entitlement.value-object.js';
import { atelierNord } from '../../../organizations.scenario.fixture.js';
import { ApplySeatEntitlement } from './apply-seat-entitlement.use-case.js';

describe('ApplySeatEntitlement', () => {
  it('uses version zero without a row and advances the plan when the limits are unchanged', async () => {
    const { organizationId, store } = await atelierNord();
    const projection = new ApplySeatEntitlement(store);
    await expect(
      projection.execute({ organizationId, entitlement: FREE_SEAT_ENTITLEMENT }),
    ).resolves.toBe('unchanged');
    expect(store.tables.seatEntitlements.has(organizationId)).toBe(false);

    const entitlement = { version: 1, plan: 'team', seatLimit: 5 };
    await expect(projection.execute({ organizationId, entitlement })).resolves.toBe('applied');
    await expect(projection.execute({ organizationId, entitlement })).resolves.toBe('unchanged');
    expect(store.tables.seatEntitlements.get(organizationId)).toEqual(entitlement);
  });

  it('retains the newest snapshot through stale, conflicting, decreasing and invalid deliveries', async () => {
    const { organizationId, store } = await atelierNord();
    const projection = new ApplySeatEntitlement(store);
    const current = { version: 4, plan: 'team', seatLimit: 18 };
    await expect(projection.execute({ organizationId, entitlement: current })).resolves.toBe(
      'applied',
    );

    for (const entitlement of [
      { ...current, version: 3, seatLimit: 24 },
      { ...current, seatLimit: 24 },
      { ...current, plan: 'enterprise' },
      { ...current, version: 5, seatLimit: 5 },
      { ...current, version: 5.1 },
      { ...current, version: 5, seatLimit: Number.MAX_SAFE_INTEGER + 1 },
      { ...current, version: 5, plan: '' },
    ]) {
      await expect(projection.execute({ organizationId, entitlement })).resolves.toBe('refused');
    }
    expect(store.tables.seatEntitlements.get(organizationId)).toEqual(current);
    expect(store.tables.events).toEqual([]);
  });
});
