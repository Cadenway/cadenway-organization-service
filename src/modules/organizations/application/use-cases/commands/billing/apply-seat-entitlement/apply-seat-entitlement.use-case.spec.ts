import { describe, expect, it } from 'vitest';

import { FREE_SEAT_ENTITLEMENT } from '../../../../../domain/value-objects/billing/seat-entitlement.value-object.js';
import { atelierNord, CAMILLE } from '../../../organizations.scenario.fixture.js';
import { GetCurrentOrganization } from '../../../queries/organizations/get-current-organization/get-current-organization.use-case.js';
import { ListMyOrganizations } from '../../../queries/organizations/list-my-organizations/list-my-organizations.use-case.js';
import { ApplySeatEntitlement } from './apply-seat-entitlement.use-case.js';

const freeStorageByteLimit = 2_000_000_000;
const teamStorageByteLimit = 100_000_000_000;

describe('ApplySeatEntitlement', () => {
  it('uses version zero without a row and advances the plan when the limits are unchanged', async () => {
    const { organizationId, store } = await atelierNord();
    const projection = new ApplySeatEntitlement(store);
    await expect(
      projection.execute({
        organizationId,
        entitlement: FREE_SEAT_ENTITLEMENT,
        storageByteLimit: freeStorageByteLimit,
      }),
    ).resolves.toBe('unchanged');
    expect(store.tables.seatEntitlements.has(organizationId)).toBe(false);

    const entitlement = { version: 1, plan: 'team', seatLimit: 5 };
    const input = { organizationId, entitlement, storageByteLimit: teamStorageByteLimit };
    await expect(projection.execute(input)).resolves.toBe('applied');
    await expect(projection.execute(input)).resolves.toBe('unchanged');
    expect(store.tables.seatEntitlements.get(organizationId)).toEqual(entitlement);
  });

  it('applies a canonical Free snapshot when an intermediate plan change was missed', async () => {
    const { organizationId, store } = await atelierNord();
    const projection = new ApplySeatEntitlement(store);
    const profile = new GetCurrentOrganization(store);
    const list = new ListMyOrganizations(store);
    const actorUserId = CAMILLE.id;
    const readPlan = (): Promise<readonly string[]> =>
      Promise.all([
        profile.execute({ organizationId, actorUserId }).then((view) => view.plan),
        list
          .execute({ actorUserId, after: null, limit: 5 })
          .then((page) => page.items[0]?.plan ?? ''),
      ]);
    await expect(readPlan()).resolves.toEqual(['free', 'free']);
    await expect(
      projection.execute({
        organizationId,
        entitlement: { version: 1, plan: 'enterprise', seatLimit: 30 },
        storageByteLimit: teamStorageByteLimit,
      }),
    ).resolves.toBe('applied');
    await expect(readPlan()).resolves.toEqual(['enterprise', 'enterprise']);

    const entitlement = { ...FREE_SEAT_ENTITLEMENT, version: 3 };
    const input = { organizationId, entitlement, storageByteLimit: freeStorageByteLimit };
    await expect(projection.execute(input)).resolves.toBe('applied');
    await expect(readPlan()).resolves.toEqual(['free', 'free']);
    await expect(projection.execute(input)).resolves.toBe('unchanged');
    await expect(
      projection.execute({
        organizationId,
        entitlement: { version: 2, plan: 'team', seatLimit: 18 },
        storageByteLimit: teamStorageByteLimit,
      }),
    ).resolves.toBe('refused');
    expect(store.tables.seatEntitlements.get(organizationId)).toEqual(entitlement);
    expect(store.tables.events).toEqual([]);
  });

  it('retains the newest snapshot through stale, conflicting, decreasing and invalid deliveries', async () => {
    const { organizationId, store } = await atelierNord();
    const projection = new ApplySeatEntitlement(store);
    const current = { version: 4, plan: 'team', seatLimit: 18 };
    await expect(
      projection.execute({
        organizationId,
        entitlement: current,
        storageByteLimit: teamStorageByteLimit,
      }),
    ).resolves.toBe('applied');

    for (const entitlement of [
      { ...current, version: 3, seatLimit: 24 },
      { ...current, seatLimit: 24 },
      { ...current, plan: 'enterprise' },
      { ...current, version: 5, seatLimit: 5 },
      { ...FREE_SEAT_ENTITLEMENT, version: 5 },
      { ...current, version: 5.1 },
      { ...current, version: 5, seatLimit: Number.MAX_SAFE_INTEGER + 1 },
      { ...current, version: 5, plan: '' },
    ]) {
      await expect(
        projection.execute({ organizationId, entitlement, storageByteLimit: teamStorageByteLimit }),
      ).resolves.toBe('refused');
    }
    await expect(
      projection.execute({
        organizationId,
        entitlement: { ...FREE_SEAT_ENTITLEMENT, seatLimit: 6, version: 5 },
        storageByteLimit: freeStorageByteLimit,
      }),
    ).resolves.toBe('refused');
    expect(store.tables.seatEntitlements.get(organizationId)).toEqual(current);
    expect(store.tables.events).toEqual([]);
  });
});
