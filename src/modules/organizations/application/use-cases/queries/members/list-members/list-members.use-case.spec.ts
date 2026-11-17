import { beforeEach, describe, expect, it } from 'vitest';

import type { MemberView } from '../../../../projections/members/member-view.projection.js';
import { atelierNord, CAMILLE, HUGO, NADIA } from '../../../organizations.scenario.fixture.js';
import type { AtelierNord } from '../../../organizations.scenario.fixture.js';
import { GetMember } from '../get-member/get-member.use-case.js';
import type { ListMembersOutput } from './list-members.output.js';
import { ListMembers } from './list-members.use-case.js';

describe('ListMembers and GetMember', () => {
  let scenario: AtelierNord;
  let list: ListMembers;

  beforeEach(async () => {
    scenario = await atelierNord();
    list = new ListMembers(scenario.store);
  });

  it('lists the members by name with the counts of every role, whatever the filters', async () => {
    const all: ListMembersOutput = await list.execute({
      actorUserId: HUGO.id,
      organizationId: scenario.organizationId,
      search: null,
      roles: null,
      after: null,
      limit: 50,
    });
    const found: ListMembersOutput = await list.execute({
      actorUserId: HUGO.id,
      organizationId: scenario.organizationId,
      search: '  INÈS ',
      roles: ['admin'],
      after: null,
      limit: 50,
    });

    expect(all.page.items.map((member: MemberView) => member.name)).toEqual([
      'Camille Martin',
      'Hugo Dubois',
      'Inès Robert',
      'Nadia Garnier',
    ]);
    expect(all.total).toBe(4);
    expect(found.page.items.map((member: MemberView) => member.name)).toEqual(['Inès Robert']);
    expect(found.total).toBe(1);
    expect(found.counts).toEqual({ owner: 1, admin: 1, member: 1, guest: 1 });
  });

  it('refuses the member list and its members to a guest and to an outsider', async () => {
    const request = {
      organizationId: scenario.organizationId,
      search: null,
      roles: null,
      after: null,
      limit: 50,
    };
    const get: GetMember = new GetMember(scenario.store);

    await expect(list.execute({ ...request, actorUserId: NADIA.id })).rejects.toMatchObject({
      refusal: { reason: 'role-forbidden' },
    });
    await expect(list.execute({ ...request, actorUserId: 'outsider' })).rejects.toMatchObject({
      refusal: { reason: 'organization-not-found' },
    });
    await expect(
      get.execute({
        actorUserId: NADIA.id,
        organizationId: scenario.organizationId,
        memberId: scenario.memberIds.get(CAMILLE.id) ?? '',
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'role-forbidden' } });
    await expect(
      get.execute({
        actorUserId: HUGO.id,
        organizationId: scenario.organizationId,
        memberId: 'unknown',
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'member-not-found' } });
  });
});
