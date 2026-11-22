import { describe, expect, it } from 'vitest';

import { atelierNord, CAMILLE, HUGO } from '../../../organizations.scenario.fixture.js';
import { CreateOrganization } from '../../organizations/create-organization/create-organization.use-case.js';
import { RemoveDeletedUser } from '../remove-deleted-user/remove-deleted-user.use-case.js';
import { ReserveAccountDeletion } from './reserve-account-deletion.use-case.js';

const attempt = '019a6c30-7a8b-7c9d-8e0f-1a2b3c4d8e91';
const otherAttempt = '019a6c30-7a8b-7c9d-8e0f-1a2b3c4d8e92';

describe('ReserveAccountDeletion', () => {
  it('uses current Organization ownership and keeps the owner account unreserved', async () => {
    const scenario = await atelierNord();
    const reserve = new ReserveAccountDeletion(scenario.store);

    await expect(reserve.execute(CAMILLE.id, attempt)).resolves.toEqual({
      status: 'owner',
      organizationIds: [scenario.organizationId],
    });
    expect(scenario.store.tables.deletionAttempts.size).toBe(0);
  });

  it('confirms the same attempt, preserves its reservation, and fences new ownership', async () => {
    const scenario = await atelierNord();
    const reserve = new ReserveAccountDeletion(scenario.store);
    const create = new CreateOrganization(scenario.store, scenario.clock);

    await expect(reserve.execute(HUGO.id, attempt)).resolves.toEqual({ status: 'created' });
    await expect(reserve.execute(HUGO.id, attempt)).resolves.toEqual({ status: 'reused' });
    await expect(reserve.execute(HUGO.id, otherAttempt)).resolves.toEqual({ status: 'conflict' });
    await expect(
      create.execute({
        actorUserId: HUGO.id,
        name: 'Atelier Nord Est',
        slug: null,
        teamSize: '1-5',
        primaryUse: 'other',
        inviteEmails: [],
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'user-not-synchronized' } });
    expect(scenario.store.tables.organizations.size).toBe(1);

    await new RemoveDeletedUser(scenario.store, scenario.clock).execute({
      userId: HUGO.id,
      version: 10,
    });
    await expect(reserve.execute(HUGO.id, attempt)).resolves.toEqual({ status: 'not-found' });
    expect(scenario.store.tables.deletionAttempts.size).toBe(0);
  });
});
