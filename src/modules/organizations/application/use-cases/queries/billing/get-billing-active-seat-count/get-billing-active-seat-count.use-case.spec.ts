import { describe, expect, it } from 'vitest';

import { atelierNord, HUGO } from '../../../organizations.scenario.fixture.js';
import { GetBillingActiveSeatCount } from './get-billing-active-seat-count.use-case.js';

describe('GetBillingActiveSeatCount', () => {
  it('counts the active owner, admins and members and excludes guests and removed members', async () => {
    const { organizationId, memberIds, store, clock } = await atelierNord();
    const query = new GetBillingActiveSeatCount(store);
    await expect(query.execute(organizationId)).resolves.toBe(3);

    const membership = store.tables.members.get(memberIds.get(HUGO.id) ?? '');
    if (membership === undefined) throw new Error('Missing fixture membership.');
    store.tables.members.set(membership.id, { ...membership, removedAt: clock.now() });
    await expect(query.execute(organizationId)).resolves.toBe(2);
    await expect(query.execute(HUGO.id)).resolves.toBeNull();
  });
});
