import { beforeEach, describe, expect, it } from 'vitest';

import { DeletedOwnerRefusal } from '../../../../models/members/deleted-owner-refusal.model.js';
import type { InvitationView } from '../../../../projections/invitations/invitation-view.projection.js';
import { atelierNord, CAMILLE, INES } from '../../../organizations.scenario.fixture.js';
import type { AtelierNord } from '../../../organizations.scenario.fixture.js';
import type { ListInvitationsOutput } from '../../../queries/invitations/list-invitations/list-invitations.output.js';
import { ListInvitations } from '../../../queries/invitations/list-invitations/list-invitations.use-case.js';
import type { InviteMembersOutput } from '../../invitations/invite-members/invite-members.output.js';
import { InviteMembers } from '../../invitations/invite-members/invite-members.use-case.js';
import { ResendInvitation } from '../../invitations/resend-invitation/resend-invitation.use-case.js';
import { RemoveDeletedUser } from './remove-deleted-user.use-case.js';

describe('RemoveDeletedUser', () => {
  let scenario: AtelierNord;
  let remove: RemoveDeletedUser;
  let marcInvitationId: string;

  beforeEach(async () => {
    scenario = await atelierNord();
    remove = new RemoveDeletedUser(scenario.store, scenario.clock);
    const batch: InviteMembersOutput = await new InviteMembers(
      scenario.store,
      scenario.clock,
    ).execute({
      actorUserId: INES.id,
      organizationId: scenario.organizationId,
      emails: ['marc.roux@ateliernord.fr'],
      role: 'member',
    });
    marcInvitationId = batch.invitations[0]?.invitationId ?? '';
    scenario.store.tables.events = [];
  });

  it('removes the memberships of the account as the system, and forgets its name and address', async () => {
    scenario.clock.advance(60_000);

    await remove.execute({ userId: INES.id, version: 7 });

    const inesMemberId: string = scenario.memberIds.get(INES.id) ?? '';
    expect(scenario.store.tables.members.get(inesMemberId)).toMatchObject({
      removedAt: new Date('2026-11-08T09:01:00Z'),
      version: 2,
    });
    expect(scenario.store.eventsNamed('member.removed.v1')).toEqual([
      {
        name: 'member.removed.v1',
        payload: expect.objectContaining({
          id: inesMemberId,
          userId: INES.id,
          role: 'admin',
          actor: 'system',
        }) as unknown,
      },
    ]);
    expect(scenario.store.tables.directory.get(INES.id)).toEqual({
      userId: INES.id,
      name: null,
      nameVersion: 7,
      email: null,
      emailVerified: false,
      emailVersion: 7,
      deleted: true,
    });
  });

  it('keeps the pending invitations the account sent, from « Ancien membre »', async () => {
    await remove.execute({ userId: INES.id, version: 7 });

    const listed: ListInvitationsOutput = await new ListInvitations(
      scenario.store,
      scenario.clock,
    ).execute({
      actorUserId: CAMILLE.id,
      organizationId: scenario.organizationId,
      after: null,
      limit: 25,
    });
    const invitation: InvitationView | undefined = listed.page.items.find(
      (item: InvitationView) => item.id === marcInvitationId,
    );
    expect(invitation).toMatchObject({
      status: 'pending',
      invitedBy: { userId: INES.id, name: 'Ancien membre' },
    });
  });

  it('lets an owner resend an invitation the deleted account sent, in the name of the owner', async () => {
    await remove.execute({ userId: INES.id, version: 7 });
    scenario.clock.advance(60 * 60_000);

    const resent: InvitationView = await new ResendInvitation(
      scenario.store,
      scenario.clock,
    ).execute({
      actorUserId: CAMILLE.id,
      organizationId: scenario.organizationId,
      invitationId: marcInvitationId,
    });

    expect(resent).toMatchObject({
      version: 2,
      invitedBy: { userId: INES.id, name: 'Ancien membre' },
    });
    expect(scenario.store.eventsNamed('invitation.issued.v1')).toEqual([
      {
        name: 'invitation.issued.v1',
        payload: expect.objectContaining({
          inviterUserId: CAMILLE.id,
          inviterName: 'Camille Martin',
        }) as unknown,
      },
    ]);
  });

  it('changes nothing when the deletion is applied again', async () => {
    await remove.execute({ userId: INES.id, version: 7 });
    const tables = scenario.store.tables;

    await remove.execute({ userId: INES.id, version: 7 });

    expect(scenario.store.tables.members).toEqual(tables.members);
    expect(scenario.store.eventsNamed('member.removed.v1')).toHaveLength(1);
  });

  it('refuses the deletion of an owner as a whole, so the organization keeps its owner', async () => {
    const tables = scenario.store.tables;

    const refusal: unknown = await remove
      .execute({ userId: CAMILLE.id, version: 7 })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(DeletedOwnerRefusal);
    expect((refusal as DeletedOwnerRefusal).organizationIds).toEqual([scenario.organizationId]);
    expect(scenario.store.tables).toBe(tables);
    expect(scenario.store.tables.directory.get(CAMILLE.id)).toMatchObject({
      name: 'Camille Martin',
      deleted: false,
    });
  });
});
