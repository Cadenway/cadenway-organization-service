import { beforeEach, describe, expect, it } from 'vitest';

import type { MemberView } from '../../../../projections/members/member-view.projection.js';
import {
  atelierNord,
  CAMILLE,
  HUGO,
  INES,
  NADIA,
} from '../../../organizations.scenario.fixture.js';
import type { AtelierNord } from '../../../organizations.scenario.fixture.js';
import { RemoveMember } from '../remove-member/remove-member.use-case.js';
import { ChangeMemberRole } from './change-member-role.use-case.js';

describe('ChangeMemberRole and RemoveMember', () => {
  let scenario: AtelierNord;
  let change: ChangeMemberRole;
  let remove: RemoveMember;

  /**
   * The membership id of a person of the scenario.
   *
   * @param userId - The account.
   * @returns The id.
   */
  function memberOf(userId: string): string {
    return scenario.memberIds.get(userId) ?? '';
  }

  beforeEach(async () => {
    scenario = await atelierNord();
    change = new ChangeMemberRole(scenario.store);
    remove = new RemoveMember(scenario.store, scenario.clock);
  });

  it('lets an admin change the role of a member, with its event and the next version', async () => {
    const changed: MemberView = await change.execute({
      actorUserId: INES.id,
      organizationId: scenario.organizationId,
      memberId: memberOf(HUGO.id),
      role: 'guest',
      expectedVersion: [1],
    });

    // The admin who changes it sees the two-step verification of the member, as in the list.
    expect(changed).toMatchObject({
      name: 'Hugo Dubois',
      role: 'guest',
      version: 2,
      twoStepVerificationEnabled: false,
    });
    expect(scenario.store.eventsNamed('member.role-changed.v1')[0]?.payload).toMatchObject({
      role: 'guest',
      previousRole: 'member',
      actorUserId: INES.id,
      version: 2,
    });
  });

  it('answers the same member without an event for the same role', async () => {
    const same: MemberView = await change.execute({
      actorUserId: CAMILLE.id,
      organizationId: scenario.organizationId,
      memberId: memberOf(HUGO.id),
      role: 'member',
      expectedVersion: null,
    });

    expect(same.version).toBe(1);
    expect(scenario.store.tables.events).toEqual([]);
  });

  it('keeps a guest unchanged when a promotion would exceed the free seat limit', async () => {
    const member = scenario.store.tables.members.get(memberOf(HUGO.id));
    if (member === undefined) throw new Error('The member fixture is missing.');
    for (const id of ['extra-one', 'extra-two']) {
      scenario.store.tables.members.set(id, { ...member, id, userId: id });
    }
    const guardedChange = new ChangeMemberRole(scenario.store, true);
    await expect(
      guardedChange.execute({
        actorUserId: CAMILLE.id,
        organizationId: scenario.organizationId,
        memberId: memberOf(NADIA.id),
        role: 'member',
        expectedVersion: [1],
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'seat-quota-exceeded' } });
    expect(scenario.store.tables.members.get(memberOf(NADIA.id))?.role).toBe('guest');
    expect(scenario.store.eventsNamed('member.role-changed.v1')).toEqual([]);
  });

  it('admits a guest promotion through the last Team seat and enforces the Team ceiling', async () => {
    const member = scenario.store.tables.members.get(memberOf(HUGO.id));
    const guest = scenario.store.tables.members.get(memberOf(NADIA.id));
    if (member === undefined || guest === undefined) throw new Error('Membership fixture missing.');
    for (const id of ['extra-one', 'extra-two']) {
      scenario.store.tables.members.set(id, { ...member, id, userId: id });
    }
    const extraGuestId = 'extra-guest';
    scenario.store.tables.members.set(extraGuestId, {
      ...guest,
      id: extraGuestId,
      userId: extraGuestId,
    });
    scenario.store.tables.seatEntitlements.set(scenario.organizationId, {
      version: 1,
      plan: 'team',
      seatLimit: 6,
    });
    const guardedChange = new ChangeMemberRole(scenario.store, true);
    const request = {
      actorUserId: CAMILLE.id,
      organizationId: scenario.organizationId,
      role: 'member' as const,
      expectedVersion: [1],
    };

    await expect(
      guardedChange.execute({ ...request, memberId: memberOf(NADIA.id) }),
    ).resolves.toMatchObject({ role: 'member', version: 2 });
    await expect(
      guardedChange.execute({ ...request, memberId: extraGuestId }),
    ).rejects.toMatchObject({ refusal: { reason: 'seat-quota-exceeded' } });
    expect(scenario.store.tables.members.get(extraGuestId)?.role).toBe('guest');
    expect(scenario.store.eventsNamed('member.role-changed.v1')).toHaveLength(1);
  });

  it('refuses a member, a stale version, the owner and an unknown member', async () => {
    const request = {
      organizationId: scenario.organizationId,
      memberId: memberOf(INES.id),
      role: 'member' as const,
      expectedVersion: null,
    };

    await expect(change.execute({ ...request, actorUserId: HUGO.id })).rejects.toMatchObject({
      refusal: { reason: 'role-forbidden' },
    });
    await expect(
      change.execute({ ...request, actorUserId: CAMILLE.id, expectedVersion: [3] }),
    ).rejects.toMatchObject({ refusal: { reason: 'version-mismatch', version: 1 } });
    await expect(
      change.execute({ ...request, actorUserId: INES.id, memberId: memberOf(CAMILLE.id) }),
    ).rejects.toMatchObject({ refusal: { reason: 'owner-protected' } });
    await expect(
      change.execute({ ...request, actorUserId: CAMILLE.id, memberId: 'unknown' }),
    ).rejects.toMatchObject({ refusal: { reason: 'member-not-found' } });
    await expect(
      change.execute({ ...request, actorUserId: 'outsider', expectedVersion: 'any' }),
    ).rejects.toMatchObject({ refusal: { reason: 'organization-not-found' } });
    expect(scenario.store.tables.events).toEqual([]);
  });

  it('removes a member with its event, and never the owner', async () => {
    await remove.execute({
      actorUserId: CAMILLE.id,
      organizationId: scenario.organizationId,
      memberId: memberOf(HUGO.id),
    });

    expect(scenario.store.eventsNamed('member.removed.v1')[0]?.payload).toMatchObject({
      role: 'member',
      version: 2,
      actorUserId: CAMILLE.id,
    });
    await expect(
      remove.execute({
        actorUserId: CAMILLE.id,
        organizationId: scenario.organizationId,
        memberId: memberOf(HUGO.id),
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'member-not-found' } });
    await expect(
      remove.execute({
        actorUserId: INES.id,
        organizationId: scenario.organizationId,
        memberId: memberOf(CAMILLE.id),
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'owner-protected' } });
    await expect(
      remove.execute({
        actorUserId: HUGO.id,
        organizationId: scenario.organizationId,
        memberId: memberOf(INES.id),
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'organization-not-found' } });
  });
});
